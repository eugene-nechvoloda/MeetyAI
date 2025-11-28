/**
 * Field Fetcher Service
 * 
 * Fetches actual field schemas from connected apps (Airtable, Linear)
 * to enable proper field mapping in the UI.
 */

import { getPrismaAsync } from "../utils/database";
import { decrypt } from "../utils/encryption";

export interface AppField {
  id: string;
  name: string;
  type: string;
  required?: boolean;
}

export interface FieldFetchResult {
  success: boolean;
  fields: AppField[];
  error?: string;
  usingDefaults?: boolean;
  defaultReason?: string;
}

const MEETY_INSIGHT_FIELDS: AppField[] = [
  { id: "title", name: "Title", type: "text", required: true },
  { id: "description", name: "Description", type: "text", required: true },
  { id: "type", name: "Type", type: "select" },
  { id: "author", name: "Author", type: "text" },
  { id: "evidence", name: "Evidence", type: "text" },
  { id: "confidence", name: "Confidence", type: "number" },
  { id: "source", name: "Source (Transcript)", type: "text" },
  { id: "status", name: "Status", type: "select" },
];

export function getMeetyFields(): AppField[] {
  return MEETY_INSIGHT_FIELDS;
}

const DEFAULT_AIRTABLE_FIELDS: AppField[] = [
  { id: "Title", name: "Title", type: "text", required: true },
  { id: "Description", name: "Description", type: "text" },
  { id: "Type", name: "Type", type: "text" },
  { id: "Author", name: "Author", type: "text" },
  { id: "Evidence", name: "Evidence", type: "text" },
  { id: "Confidence", name: "Confidence", type: "number" },
  { id: "Source", name: "Source", type: "text" },
  { id: "Status", name: "Status", type: "text" },
  { id: "Notes", name: "Notes", type: "text" },
];

export async function fetchAirtableFields(configId: string): Promise<FieldFetchResult> {
  try {
    const prisma = await getPrismaAsync();
    
    const config = await prisma.exportConfig.findUnique({
      where: { id: configId },
    });
    
    if (!config || config.provider !== "airtable") {
      return { success: false, fields: [], error: "Airtable configuration not found" };
    }
    
    const credentials = JSON.parse(decrypt(config.credentials_encrypted));
    const baseId = credentials.base_id || config.base_id;
    const tableName = config.table_name || credentials.table_name || "Insights";
    
    if (!credentials.api_key || !baseId) {
      return { success: false, fields: [], error: "Missing API key or Base ID" };
    }
    
    console.log("[FieldFetcher] Fetching Airtable fields", { baseId, tableName });
    
    try {
      const response = await fetch(
        `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
        {
          headers: {
            Authorization: `Bearer ${credentials.api_key}`,
          },
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[FieldFetcher] Airtable Meta API error:", response.status, errorText);
        
        // Airtable has TWO error formats:
        // Format 1 (Meta API): { error: { type: "...", message: "..." } }
        // Format 2 (Data API): { error: "ERROR_CODE", message: "...", statusCode: 404 }
        let errorType = "";
        let errorMessage = "";
        try {
          const errorJson = JSON.parse(errorText);
          // Handle both formats
          if (typeof errorJson.error === "object" && errorJson.error !== null) {
            // Format 1: Meta API style
            errorType = errorJson.error?.type || "";
            errorMessage = errorJson.error?.message || "";
          } else if (typeof errorJson.error === "string") {
            // Format 2: Data API style
            errorType = errorJson.error;
            errorMessage = errorJson.message || "";
          }
          console.log("[FieldFetcher] Parsed Airtable error:", { errorType, errorMessage, format: typeof errorJson.error });
        } catch {
          console.log("[FieldFetcher] Could not parse error JSON");
        }
        
        // Check for NOT_FOUND errors
        if (response.status === 404 || errorType === "NOT_FOUND") {
          console.log("[FieldFetcher] Base or table not found. Using default fields.");
          return { 
            success: true, 
            fields: DEFAULT_AIRTABLE_FIELDS,
            usingDefaults: true,
            defaultReason: `Could not find your Airtable base or table. Please verify your Base ID (${baseId}) and table name are correct.`,
          };
        }
        
        if (response.status === 401 || response.status === 403) {
          // Provide specific message based on the actual error type
          let reason = "";
          
          if (errorType === "AUTHENTICATION_REQUIRED" || errorType === "INVALID_API_KEY") {
            reason = "Your Airtable API key appears to be invalid or expired. Please check your API key in Settings.";
          } else if (errorType === "NOT_AUTHORIZED" || errorType === "INVALID_PERMISSIONS") {
            reason = `Your API key doesn't have access to this base. Make sure the Personal Access Token has access to the workspace containing base ${baseId}.`;
          } else if (errorType === "INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND") {
            reason = `Base not found or not accessible. Verify the Base ID (${baseId}) and ensure your API key has access to it.`;
          } else if (errorMessage.toLowerCase().includes("scope")) {
            reason = `Missing required scope: ${errorMessage}. Please update your Personal Access Token.`;
          } else if (errorMessage) {
            reason = `Airtable error: ${errorMessage}`;
          } else {
            // Generic fallback - but mention it could be access issue, not just scope
            reason = `Could not access Airtable schema. This could be: 1) API key lacks access to base ${baseId}, 2) Base ID is incorrect, or 3) Missing schema:bases:read scope.`;
          }
          
          console.log("[FieldFetcher] Auth error - using default fields.", { reason });
          return { 
            success: true, 
            fields: DEFAULT_AIRTABLE_FIELDS,
            usingDefaults: true,
            defaultReason: reason,
          };
        }
        
        console.log("[FieldFetcher] API error - falling back to default fields");
        return { 
          success: true, 
          fields: DEFAULT_AIRTABLE_FIELDS,
          usingDefaults: true,
          defaultReason: errorMessage || "Could not connect to Airtable. Using common default fields.",
        };
      }
      
      const data = await response.json() as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string }> }> };
      
      console.log("[FieldFetcher] Found tables:", data.tables?.map(t => t.name));
      
      const table = data.tables?.find(t => 
        t.name.toLowerCase() === tableName.toLowerCase() ||
        t.id === tableName
      );
      
      if (!table) {
        const availableTables = data.tables?.map(t => t.name).join(", ") || "none";
        console.log("[FieldFetcher] Table not found, available:", availableTables);
        return { 
          success: true, 
          fields: DEFAULT_AIRTABLE_FIELDS,
          usingDefaults: true,
          defaultReason: `Table "${tableName}" not found. Available tables: ${availableTables}. Using default fields.`,
        };
      }
      
      console.log("[FieldFetcher] Found table fields:", table.fields?.map(f => f.name));
      
      const fields: AppField[] = table.fields.map(f => ({
        id: f.name,
        name: f.name,
        type: f.type,
      }));
      
      return { success: true, fields };
    } catch (fetchError) {
      console.error("[FieldFetcher] Fetch error - using default fields:", fetchError);
      return { 
        success: true, 
        fields: DEFAULT_AIRTABLE_FIELDS,
        usingDefaults: true,
        defaultReason: "Network error connecting to Airtable. Using common default fields.",
      };
    }
  } catch (error) {
    console.error("[FieldFetcher] Error fetching Airtable fields:", error);
    return { 
      success: true, 
      fields: DEFAULT_AIRTABLE_FIELDS,
      usingDefaults: true,
      defaultReason: "Error reading configuration. Using common default fields.",
    };
  }
}

const LINEAR_ISSUE_FIELDS: AppField[] = [
  { id: "title", name: "Title", type: "text", required: true },
  { id: "description", name: "Description", type: "text" },
  { id: "priority", name: "Priority", type: "select" },
  { id: "estimate", name: "Estimate", type: "number" },
  { id: "labelIds", name: "Labels", type: "multiselect" },
];

export async function fetchLinearFields(configId: string): Promise<FieldFetchResult> {
  try {
    return { success: true, fields: LINEAR_ISSUE_FIELDS };
  } catch (error) {
    console.error("[FieldFetcher] Error fetching Linear fields:", error);
    return { 
      success: false, 
      fields: [], 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

export async function fetchFieldsForConfig(configId: string, provider: string): Promise<FieldFetchResult> {
  switch (provider) {
    case "airtable":
      return fetchAirtableFields(configId);
    case "linear":
      return fetchLinearFields(configId);
    default:
      return { success: false, fields: [], error: `Unknown provider: ${provider}` };
  }
}
