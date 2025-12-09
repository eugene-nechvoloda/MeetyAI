/**
 * Upload Transcript Modal Handler
 */

import type { ViewSubmitAction, SlackViewMiddlewareArgs } from '@slack/bolt';
import { TranscriptOrigin } from '@prisma/client';
import { logger, prisma } from '../../index.js';
import { processTranscript } from '../../services/transcriptProcessor.js';

export async function handleUploadModal({
  ack,
  body,
  view,
  client,
}: SlackViewMiddlewareArgs<ViewSubmitAction>) {
  const values = view.state.values;
  const userId = body.user.id;

  const transcriptText = values.transcript_text_block?.transcript_text?.value;
  const transcriptLink = values.transcript_link_block?.transcript_link?.value;
  const transcriptTitle = values.title_input?.title?.value || `Upload from App Home - ${new Date().toLocaleDateString()}`;
  const fileIds = values.file_input?.file_input?.files;

  logger.info('📤 [Upload Modal] Processing submission', {
    hasText: !!transcriptText,
    hasLink: !!transcriptLink,
    hasFile: !!fileIds && fileIds.length > 0,
    userId,
  });

  let content = '';
  let origin: TranscriptOrigin;
  let fileName: string | undefined;

  // Priority: File > Text > Link
  if (fileIds && fileIds.length > 0) {
    try {
      const fileId = fileIds[0].id;
      logger.info(`📄 [Upload Modal] Downloading file ${fileId}`);

      const fileInfo = await client.files.info({ file: fileId });
      if (!fileInfo.file) {
        await ack({
          response_action: 'errors',
          errors: {
            file_input: 'File not found',
          },
        });
        return;
      }

      fileName = fileInfo.file.name;
      const fileUrl = fileInfo.file.url_private_download;

      if (!fileUrl) {
        await ack({
          response_action: 'errors',
          errors: {
            file_input: 'File download URL not available',
          },
        });
        return;
      }

      // Download file content
      const response = await fetch(fileUrl, {
        headers: {
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }

      content = await response.text();
      origin = TranscriptOrigin.file_upload;

      logger.info(`✅ [Upload Modal] File downloaded: ${fileName}`);
    } catch (error) {
      logger.error('❌ [Upload Modal] File download failed:', error);
      await ack({
        response_action: 'errors',
        errors: {
          file_input: error instanceof Error ? error.message : 'Failed to process file',
        },
      });
      return;
    }
  } else if (transcriptText) {
    content = transcriptText;
    origin = TranscriptOrigin.paste;
  } else if (transcriptLink) {
    content = transcriptLink;
    origin = TranscriptOrigin.link;
  } else {
    await ack({
      response_action: 'errors',
      errors: {
        transcript_text_block: 'Please provide a file, text, or link',
      },
    });
    return;
  }

  // Acknowledge modal submission
  await ack();

  try {
    // Create transcript
    const transcript = await prisma.transcript.create({
      data: {
        title: transcriptTitle,
        origin,
        status: 'pending',
        slack_user_id: userId,
        slack_channel_id: 'app_home',
        raw_content: content,
        transcript_text: content,
        language: 'en',
        file_name: fileName,
        link_url: transcriptLink,
      },
    });

    logger.info(`✅ [Upload Modal] Transcript created: ${transcript.id}`);

    // Start processing in background
    processTranscript(transcript.id).catch(error => {
      logger.error(`❌ Background processing failed for ${transcript.id}:`, error);
    });

    // Send confirmation
    await client.chat.postMessage({
      channel: userId,
      text: `✅ Transcript "${transcriptTitle}" uploaded and processing started!`,
    });

  } catch (error) {
    logger.error('❌ [Upload Modal] Failed to create transcript:', error);

    await client.chat.postMessage({
      channel: userId,
      text: `❌ Failed to process transcript: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}
