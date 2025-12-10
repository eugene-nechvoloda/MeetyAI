/**
 * Slack Event Handlers
 *
 * Registers all Slack event listeners, modals, actions, and commands
 */

import { slack, logger } from '../index.js';
import { buildHomeTab } from './views/appHome.js';
import { handleUploadModal } from './modals/uploadTranscript.js';
import { processTranscript } from '../services/transcriptProcessor.js';
import { prisma } from '../index.js';

// App Home opened
slack.event('app_home_opened', async ({ event, client }) => {
  try {
    logger.info(`App home opened by user ${event.user}`);

    const view = await buildHomeTab(event.user);

    await client.views.publish({
      user_id: event.user,
      view,
    });
  } catch (error) {
    logger.error('Error handling app_home_opened:', error);
  }
});

// Upload transcript modal submission
slack.view('upload_transcript_modal', handleUploadModal);

// Re-analyze transcript button
slack.action(/^transcript_menu_/, async ({ body, ack, client, action }) => {
  await ack();

  try {
    if (action.type !== 'overflow') return;

    const selectedOption = action.selected_option;
    const transcriptId = selectedOption.value;
    const userId = body.user.id;

    logger.info(`Action ${selectedOption.text.text} for transcript ${transcriptId}`);

    if (selectedOption.text.text.includes('Re-analyze')) {
      // Trigger re-analysis
      processTranscript(transcriptId).catch(error => {
        logger.error(`Re-analysis failed for ${transcriptId}:`, error);
      });

      await client.chat.postMessage({
        channel: userId,
        text: `🔄 Re-analysis started for transcript.`,
      });
    } else if (selectedOption.text.text.includes('Archive')) {
      // Archive transcript
      await prisma.transcript.update({
        where: { id: transcriptId },
        data: { archived: true, archived_at: new Date() },
      });

      await client.chat.postMessage({
        channel: userId,
        text: `🗑️ Transcript archived.`,
      });
    }

    // Refresh App Home
    const view = await buildHomeTab(userId);
    await client.views.publish({ user_id: userId, view });

  } catch (error) {
    logger.error('Error handling transcript menu action:', error);
  }
});

// Upload button - opens modal
slack.action('upload_transcript_button', async ({ body, ack, client }) => {
  await ack();

  try {
    const { buildUploadModal } = await import('./views/uploadModal.js');

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildUploadModal(),
    });
  } catch (error) {
    logger.error('Error opening upload modal:', error);
  }
});

logger.info('✅ Slack handlers registered');
