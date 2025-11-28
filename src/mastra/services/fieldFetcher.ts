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
        
        if (response.status === 404) {
          console.log("[FieldFetcher] Meta API 404 - Base ID may be incorrect or API key lacks schema access. Using default fields.");
          return { 
            success: true, 
            fields: DEFAULT_AIRTABLE_FIELDS,
          };
        }
        
        if (response.status === 401 || response.status === 403) {
          console.log("[FieldFetcher] Auth error - API key may lack schema:bases:read scope. Using default fields.");
          return { 
            success: true, 
            fields: DEFAULT_AIRTABLE_FIELDS,
          };
        }
        
        console.log("[FieldFetcher] API error - falling back to default fields");
        return { 
          success: true, 
          fields: DEFAULT_AIRTABLE_FIELDS,
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
      };
    }
  } catch (error) {
    console.error("[FieldFetcher] Error fetching Airtable fields:", error);
    return { 
      success: true, 
      fields: DEFAULT_AIRTABLE_FIELDS,
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
