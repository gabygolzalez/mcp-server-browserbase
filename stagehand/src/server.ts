import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { Stagehand } from "@browserbasehq/stagehand";
import type { ConstructorParams } from "@browserbasehq/stagehand";

import { sanitizeMessage } from "./utils.js";
import { log, logRequest, logResponse, operationLogs, setServerInstance } from "./logging.js";
import { TOOLS, handleToolCall } from "./tools.js";
import { PROMPTS, getPrompt } from "./prompts.js";
import { listResources, listResourceTemplates, readResource } from "./resources.js";

// Interface for API keys
export interface ApiKeys {
  browserbaseApiKey?: string;
  browserbaseProjectId?: string;
  openaiApiKey?: string;
}

// Define Stagehand configuration
export function getStagehandConfig(apiKeys?: ApiKeys): ConstructorParams {
  // Use provided API keys or fall back to environment variables
  const browserbaseApiKey = apiKeys?.browserbaseApiKey || process.env.BROWSERBASE_API_KEY;
  const browserbaseProjectId = apiKeys?.browserbaseProjectId || process.env.BROWSERBASE_PROJECT_ID;
  const openaiApiKey = apiKeys?.openaiApiKey || process.env.OPENAI_API_KEY;

  return {
    env:
      browserbaseApiKey && browserbaseProjectId
        ? "BROWSERBASE"
        : "LOCAL",
    apiKey: browserbaseApiKey /* API key for authentication */,
    projectId: browserbaseProjectId /* Project identifier */,
    debugDom: false /* Enable DOM debugging features */,
    headless: false /* Run browser in headless mode */,
    logger: (message) =>
      console.error(logLineToString(message)) /* Custom logging function to stderr */,
    domSettleTimeoutMs: 30_000 /* Timeout for DOM to settle in milliseconds */,
    browserbaseSessionCreateParams: {
      projectId: browserbaseProjectId!,
      browserSettings: process.env.CONTEXT_ID ? {
          context: {
            id: process.env.CONTEXT_ID,
            persist: true
          }
      } : undefined
    },
    enableCaching: true /* Enable caching functionality */,
    browserbaseSessionID:
      undefined /* Session ID for resuming Browserbase sessions */,
    modelName: "gpt-4o" /* Name of the model to use */,
    modelClientOptions: {
      apiKey: openaiApiKey,
    } /* Configuration options for the model client */,
    useAPI: false,
  };
}

// Global state
let stagehand: Stagehand | undefined;
let currentConfig: ConstructorParams | undefined;

// Ensure Stagehand is initialized with the current configuration
export async function ensureStagehand(apiKeys?: ApiKeys) {
  try {
    const newConfig = getStagehandConfig(apiKeys);

    // Determine if we need to reinitialize with new config
    const shouldReinitialize = !stagehand ||
      JSON.stringify(newConfig) !== JSON.stringify(currentConfig);

    if (shouldReinitialize) {
      if (stagehand) {
        // Attempt to close existing session
        try {
          await stagehand.page.close();
        } catch (error) {
          // Ignore errors on close
        }
      }

      // Create new instance with updated config
      currentConfig = newConfig;
      stagehand = new Stagehand(currentConfig);
      await stagehand.init();
      return stagehand;
    }

    // Try to perform a simple operation to check if the session is still valid
    try {
      if (!stagehand) {
        // If stagehand is somehow still undefined, initialize it
        stagehand = new Stagehand(currentConfig || newConfig);
        await stagehand.init();
        return stagehand;
      }

      await stagehand.page.evaluate(() => document.title);
      return stagehand;
    } catch (error) {
      // If we get an error indicating the session is invalid, reinitialize
      if (error instanceof Error &&
          (error.message.includes('Target page, context or browser has been closed') ||
          error.message.includes('Session expired') ||
          error.message.includes('context destroyed'))) {
        log('Browser session expired, reinitializing Stagehand...', 'info');
        currentConfig = currentConfig || newConfig;
        stagehand = new Stagehand(currentConfig);
        await stagehand.init();
        return stagehand;
      }
      throw error; // Re-throw if it's a different type of error
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Failed to initialize/reinitialize Stagehand: ${errorMsg}`, 'error');
    throw error;
  }
}

// Create the server
export function createServer(apiKeys?: ApiKeys) {
  const server = new Server(
    {
      name: "stagehand",
      version: "0.1.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
        logging: {},
        prompts: {}
      },
    }
  );

  // Store server instance for logging
  setServerInstance(server);

  // Setup request handlers
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    try {
      logRequest('ListTools', request.params);
      const response = { tools: TOOLS };
      const sanitizedResponse = sanitizeMessage(response);
      logResponse('ListTools', JSON.parse(sanitizedResponse));
      return JSON.parse(sanitizedResponse);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        error: {
          code: -32603,
          message: `Internal error: ${errorMsg}`,
        },
      };
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      logRequest('CallTool', request.params);
      operationLogs.length = 0; // Clear logs for new operation

      if (!request.params?.name || !TOOLS.find(t => t.name === request.params.name)) {
        throw new Error(`Invalid tool name: ${request.params?.name}`);
      }

      // Ensure Stagehand is initialized
      try {
        const stagehandInstance = await ensureStagehand(apiKeys);
        if (!stagehandInstance) {
          throw new Error("Failed to initialize Stagehand: instance is undefined");
        }

        const result = await handleToolCall(
          request.params.name,
          request.params.arguments ?? {},
          stagehandInstance
        );

        const sanitizedResult = sanitizeMessage(result);
        logResponse('CallTool', JSON.parse(sanitizedResult));
        return JSON.parse(sanitizedResult);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Failed to initialize Stagehand: ${errorMsg}`,
            },
            {
              type: "text",
              text: `Operation logs:\n${operationLogs.join("\n")}`,
            },
          ],
          isError: true,
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        error: {
          code: -32603,
          message: `Internal error: ${errorMsg}`,
        },
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    try {
      logRequest('ListResources', request.params);
      const response = listResources();
      const sanitizedResponse = sanitizeMessage(response);
      logResponse('ListResources', JSON.parse(sanitizedResponse));
      return JSON.parse(sanitizedResponse);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        error: {
          code: -32603,
          message: `Internal error: ${errorMsg}`,
        },
      };
    }
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => {
    try {
      logRequest('ListResourceTemplates', request.params);
      const response = listResourceTemplates();
      const sanitizedResponse = sanitizeMessage(response);
      logResponse('ListResourceTemplates', JSON.parse(sanitizedResponse));
      return JSON.parse(sanitizedResponse);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        error: {
          code: -32603,
          message: `Internal error: ${errorMsg}`,
        },
      };
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      logRequest('ReadResource', request.params);
      const uri = request.params.uri.toString();
      const response = readResource(uri);
      const sanitizedResponse = sanitizeMessage(response);
      logResponse('ReadResource', JSON.parse(sanitizedResponse));
      return JSON.parse(sanitizedResponse);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        error: {
          code: -32603,
          message: `Internal error: ${errorMsg}`,
        },
      };
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
    try {
      logRequest('ListPrompts', request.params);
      const response = { prompts: PROMPTS };
      const sanitizedResponse = sanitizeMessage(response);
      logResponse('ListPrompts', JSON.parse(sanitizedResponse));
      return JSON.parse(sanitizedResponse);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        error: {
          code: -32603,
          message: `Internal error: ${errorMsg}`,
        },
      };
    }
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    try {
      logRequest('GetPrompt', request.params);
      
      // Check if prompt name is valid and get the prompt
      try {
        const prompt = getPrompt(request.params?.name || "");
        const sanitizedResponse = sanitizeMessage(prompt);
        logResponse('GetPrompt', JSON.parse(sanitizedResponse));
        return JSON.parse(sanitizedResponse);
      } catch (error) {
        throw new Error(`Invalid prompt name: ${request.params?.name}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        error: {
          code: -32603,
          message: `Internal error: ${errorMsg}`,
        },
      };
    }
  });

  return server;
}

// Import missing function from logging
import { formatLogResponse, logLineToString } from "./logging.js"; 