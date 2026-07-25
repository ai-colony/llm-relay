// The schemas live in @lib because src/lib/openAI.ts needs them too; re-exported here so the chat
// route and the OpenAPI document keep importing them from their own folder.
export {
  type RelayChatRequest,
  RelayChatRequestSchema,
  type RelayMessage,
  RelayMessageSchema,
  type RelayTool,
  RelayToolSchema
} from '../../lib/chatSchemas';
