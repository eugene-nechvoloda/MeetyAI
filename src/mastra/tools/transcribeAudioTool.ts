/**
 * Transcribe Audio Tool
 * 
 * Extracts audio from media files and transcribes using OpenAI Whisper API
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { OpenAI } from "openai";
import { createLogger } from "../utils/logger";
import { getPrisma } from "../utils/database";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const transcribeAudioTool = createTool({
  id: "transcribe-audio-with-whisper",
  description: "Transcribes audio/video files using OpenAI Whisper API. Extracts audio from video files if needed, then generates transcript with timestamps. Use this for audio/video file uploads or recordings.",
  
  inputSchema: z.object({
    fileBuffer: z.instanceof(Buffer).describe("Buffer containing the audio/video file"),
    fileName: z.string().describe("Name of the media file"),
    fileType: z.string().describe("MIME type of the file"),
    includeTimestamps: z.boolean().optional().default(true).describe("Whether to include timestamps in transcript"),
  }),
  
  outputSchema: z.object({
    transcript: z.string().describe("Transcribed text"),
    duration: z.number().optional().describe("Duration in seconds"),
    language: z.string().optional().describe("Detected language"),
    segments: z.array(z.object({
      text: z.string(),
      start: z.number(),
      end: z.number(),
    })).optional().describe("Transcript segments with timestamps"),
    success: z.boolean().describe("Whether transcription was successful"),
    error: z.string().optional().describe("Error message if failed"),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = createLogger(mastra, "TranscribeAudioTool");
    const { fileBuffer, fileName, fileType, includeTimestamps } = context;
    
    logger.toolStart("transcribe-audio-with-whisper", { fileName, fileType });
    
    try {
      // Get OpenAI API key from database settings
      const prisma = getPrisma();
      const openaiConfig = await prisma.modelConfig.findFirst({
        where: {
          provider: "openai",
          model_type: "whisper",
        },
      });
      
      if (!openaiConfig) {
        logger.error("OpenAI Whisper configuration not found in settings");
        return {
          transcript: "",
          success: false,
          error: "OpenAI Whisper not configured. Please add OpenAI API key in Settings > Models.",
        };
      }
      
      // Decrypt API key
      const { decrypt } = await import("../utils/encryption");
      const apiKey = decrypt(openaiConfig.api_key_encrypted);
      
      // Initialize OpenAI client
      const openai = new OpenAI({ apiKey });
      
      // Create temporary file
      const tmpDir = "/tmp/metiy";
      await fs.mkdir(tmpDir, { recursive: true });
      const tmpFilePath = path.join(tmpDir, `upload_${Date.now()}_${fileName}`);
      let audioFilePath = tmpFilePath;
      
      try {
        await fs.writeFile(tmpFilePath, fileBuffer);
        logger.progress("Temporary file created", { tmpFilePath });
        
        // Check if video file - extract audio if needed
        const isVideo = fileType.includes("video") || [".mp4", ".mov", ".avi", ".mkv", ".webm"].some(ext => fileName.toLowerCase().endsWith(ext));
        
        if (isVideo) {
          logger.progress("Video file detected, extracting audio...");
          const audioOutputPath = tmpFilePath.replace(/\.[^/.]+$/, ".mp3");
          
          try {
            // Use ffmpeg to extract audio (assuming it's available in the environment)
            await execAsync(`ffmpeg -i "${tmpFilePath}" -vn -acodec libmp3lame -q:a 2 "${audioOutputPath}"`);
            audioFilePath = audioOutputPath;
            logger.progress("Audio extracted successfully");
          } catch (ffmpegError) {
            logger.warn("FFmpeg not available or extraction failed, attempting direct transcription", { error: ffmpegError });
            // Continue with original file
          }
        }
        
        // Transcribe with Whisper
        logger.progress("Transcribing with Whisper API...");
        
        const fileStream = await fs.open(audioFilePath, "r");
        
        const transcription = await openai.audio.transcriptions.create({
          file: fileStream.createReadStream(),
          model: "whisper-1",
          response_format: includeTimestamps ? "verbose_json" : "text",
          language: undefined, // Auto-detect
        });
        
        await fileStream.close();
        
        logger.progress("Transcription complete");
        
        // Parse response
        let transcript: string;
        let duration: number | undefined;
        let language: string | undefined;
        let segments: Array<{ text: string; start: number; end: number }> | undefined;
        
        if (typeof transcription === "string") {
          transcript = transcription;
        } else {
          // Verbose JSON response
          transcript = (transcription as any).text || "";
          duration = (transcription as any).duration;
          language = (transcription as any).language;
          
          if (includeTimestamps && (transcription as any).segments) {
            segments = (transcription as any).segments.map((seg: any) => ({
              text: seg.text,
              start: seg.start,
              end: seg.end,
            }));
          }
        }
        
        logger.toolComplete("transcribe-audio-with-whisper", {
          transcriptLength: transcript.length,
          duration,
          language,
          segmentCount: segments?.length,
        });
        
        return {
          transcript,
          duration,
          language,
          segments,
          success: true,
        };
      } finally {
        // Cleanup temporary files
        try {
          await fs.unlink(tmpFilePath);
          if (audioFilePath !== tmpFilePath) {
            await fs.unlink(audioFilePath);
          }
        } catch (cleanupError) {
          logger.warn("Failed to cleanup temporary files", { error: cleanupError });
        }
      }
    } catch (error) {
      logger.toolError("transcribe-audio-with-whisper", error as Error);
      return {
        transcript: "",
        success: false,
        error: `Transcription failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
