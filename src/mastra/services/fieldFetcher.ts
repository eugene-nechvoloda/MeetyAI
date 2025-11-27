/**
 * Field Fetcher Service
 * 
 * Fetches actual field schemas from connected apps (Airtable, Linear)
 * to enable proper field mapping in the UI.
 */

import Airtable from "airtable";
import { LinearClient } from "@linear/sdk";
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
    const baseId = credentials.base_id || config.team_id;
    const tableName = credentials.table_name || "Insights";
    
    if (!credentials.api_key || !baseId) {
      return { success: false, fields: [], error: "Missing API key or Base ID" };
    }
    
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
      console.error("[FieldFetcher] Airtable API error:", errorText);
      return { 
        success: false, 
        fields: [], 
        error: `Airtable API error: ${response.status}` 
      };
    }
    
    const data = await response.json() as { tables: Array<{ name: string; fields: Array<{ id: string; name: string; type: string }> }> };
    const table = data.tables?.find(t => 
      t.name.toLowerCase() === tableName.toLowerCase()
    );
    
    if (!table) {
      return { 
        success: false, 
        fields: [], 
        error: `Table "${tableName}" not found in base` 
      };
    }
    
    const fields: AppField[] = table.fields.map(f => ({
      id: f.id,
      name: f.name,
      type: f.type,
    }));
    
    return { success: true, fields };
  } catch (error) {
    console.error("[FieldFetcher] Error fetching Airtable fields:", error);
    return { 
      success: false, 
      fields: [], 
      error: error instanceof Error ? error.message : "Unknown error" 
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
