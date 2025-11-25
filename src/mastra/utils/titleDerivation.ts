/**
 * Title Derivation Utility
 * 
 * Derives titles from different transcript origins following MeetyAI rules:
 * - File upload: exact filename.ext
 * - Paste: first sentence (<=120 chars), fallback "Pasted transcript — {timestamp}"
 * - Link: domain — slug TitleCase (use quick metadata if feasible)
 */

import { TranscriptOrigin } from "./prismaTypes";

interface TitleDerivationInput {
  origin: TranscriptOrigin;
  fileName?: string;
  textContent?: string;
  linkUrl?: string;
}

/**
 * Derives a title based on the transcript origin and available data
 */
export function deriveTitle(input: TitleDerivationInput): string {
  const { origin, fileName, textContent, linkUrl } = input;

  switch (origin) {
    case "file_upload":
      return deriveTitleFromFile(fileName);
    
    case "paste":
      return deriveTitleFromPaste(textContent);
    
    case "link":
    case "zoom_import":
    case "fireflies_import":
    case "custom_api":
      return deriveTitleFromLink(linkUrl);
    
    default:
      return `Transcript — ${new Date().toISOString()}`;
  }
}

/**
 * File: exact filename.ext
 */
function deriveTitleFromFile(fileName?: string): string {
  if (!fileName || fileName.trim() === "") {
    return `Uploaded File — ${new Date().toISOString()}`;
  }
  return fileName.trim();
}

/**
 * Paste: first sentence (<=120 chars), fallback "Pasted transcript — {timestamp}"
 */
function deriveTitleFromPaste(textContent?: string): string {
  if (!textContent || textContent.trim() === "") {
    return `Pasted transcript — ${new Date().toISOString()}`;
  }

  // Extract first sentence
  const text = textContent.trim();
  
  // Try to find sentence ending
  const sentenceEndings = /[.!?]\s/;
  const match = text.match(sentenceEndings);
  
  let firstSentence = match 
    ? text.substring(0, text.indexOf(match[0]) + 1).trim()
    : text;

  // Limit to 120 chars
  if (firstSentence.length > 120) {
    firstSentence = firstSentence.substring(0, 117) + "...";
  }

  // Fallback if empty or too short
  if (firstSentence.length < 3) {
    return `Pasted transcript — ${new Date().toISOString()}`;
  }

  return firstSentence;
}

/**
 * Link: domain — slug TitleCase (use quick metadata if feasible)
 */
function deriveTitleFromLink(linkUrl?: string): string {
  if (!linkUrl || linkUrl.trim() === "") {
    return `Link — ${new Date().toISOString()}`;
  }

  try {
    const url = new URL(linkUrl);
    const domain = url.hostname.replace(/^www\./, "");
    
    // Extract path slug
    const pathParts = url.pathname
      .split("/")
      .filter(part => part.length > 0);
    
    if (pathParts.length === 0) {
      return toTitleCase(domain);
    }

    // Get last meaningful path segment
    const slug = pathParts[pathParts.length - 1]
      .replace(/\.[^/.]+$/, "") // Remove file extension
      .replace(/[-_]/g, " ");    // Replace dashes/underscores with spaces
    
    const titleCaseSlug = toTitleCase(slug);
    
    return `${toTitleCase(domain)} — ${titleCaseSlug}`;
  } catch (error) {
    // Invalid URL, return fallback
    return `Link — ${new Date().toISOString()}`;
  }
}

/**
 * Converts string to Title Case
 */
function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(" ")
    .map(word => {
      if (word.length === 0) return word;
      // Keep common small words lowercase (except if first word)
      const smallWords = ["a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "from", "by", "of", "in"];
      if (smallWords.includes(word)) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ")
    .replace(/^./, (char) => char.toUpperCase()); // Always capitalize first character
}

/**
 * Derives a title with metadata enrichment (for future use with web scraping)
 */
export async function deriveTitleWithMetadata(
  input: TitleDerivationInput,
  fetchMetadata: boolean = false
): Promise<string> {
  // For now, use basic derivation
  // In future: fetch OpenGraph tags, page titles, etc.
  return deriveTitle(input);
}
