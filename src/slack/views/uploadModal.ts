/**
 * Upload Transcript Modal View
 */

export function buildUploadModal() {
  return {
    type: 'modal',
    callback_id: 'upload_transcript_modal',
    title: {
      type: 'plain_text',
      text: 'Upload Transcript',
    },
    submit: {
      type: 'plain_text',
      text: 'Analyze',
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
    },
    blocks: [
      {
        type: 'input',
        block_id: 'title_input',
        element: {
          type: 'plain_text_input',
          action_id: 'title',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., Product Strategy Meeting - Jan 2025',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Transcript Title',
        },
      },
      {
        type: 'input',
        block_id: 'file_input',
        optional: true,
        element: {
          type: 'file_input',
          action_id: 'file_input',
          filetypes: ['txt', 'pdf', 'doc', 'docx'],
          max_files: 1,
        },
        label: {
          type: 'plain_text',
          text: 'Upload File',
        },
        hint: {
          type: 'plain_text',
          text: 'Upload a transcript file (TXT, PDF, DOC)',
        },
      },
      {
        type: 'input',
        block_id: 'transcript_text_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'transcript_text',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Paste your transcript here...',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Or Paste Text',
        },
      },
      {
        type: 'input',
        block_id: 'transcript_link_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'transcript_link',
          placeholder: {
            type: 'plain_text',
            text: 'https://...',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Or Link to Transcript',
        },
      },
    ],
  };
}
