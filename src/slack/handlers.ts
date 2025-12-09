/**
 * Slack Event Handlers
 *
 * Registers all Slack event listeners, modals, actions, and commands
 */

import type { App } from '@slack/bolt';
import type pino from 'pino';
import { buildHomeTab } from './views/appHome.js';
import { handleUploadModal } from './modals/uploadTranscript.js';
import { processTranscript } from '../services/transcriptProcessor.js';

export function registerHandlers(slack: App, logger: ReturnType<typeof pino>) {
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

  // Overflow menu actions (re-analyze, archive)
  slack.action(/^transcript_menu_.*/, async ({ body, ack, action, client }) => {
    await ack();

    try {
      // @ts-ignore - action.selected_option exists for overflow menus
      const selectedOption = action.selected_option;
      const transcriptId = selectedOption.value;
      const actionText = selectedOption.text.text;
      const userId = body.user.id;

      logger.info(`Transcript action: ${actionText} for ${transcriptId}`);

      if (actionText.includes('Re-analyze')) {
        // Re-analyze transcript
        logger.info(`Re-analyze requested for transcript ${transcriptId}`);

        processTranscript(transcriptId).catch(error => {
          logger.error(`Re-analysis failed for ${transcriptId}:`, error);
        });
      } else if (actionText.includes('Archive')) {
        // Archive transcript
        logger.info(`Archive requested for transcript ${transcriptId}`);

        const { prisma } = await import('../index.js');
        await prisma.transcript.update({
          where: { id: transcriptId },
          data: { archived: true, archived_at: new Date() },
        });
      }

      // Update view
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
}
