import { z } from "zod";
import {
  createServiceToken,
  type HarnessPlugin,
  type JsonValue,
} from "@memorall/agent-harness-core";

export interface ChildAgentRequest {
  agentId: string;
  message: string;
  scope: Readonly<Record<string, string>>;
  signal: AbortSignal;
}

export interface ChildAgentResult {
  response: string;
  metadata?: JsonValue;
}

export interface ChildAgentService {
  send(request: ChildAgentRequest): Promise<ChildAgentResult>;
}

export const CHILD_AGENT_SERVICE = createServiceToken<ChildAgentService>("childAgent", {
  description: "Child agent resolution and invocation",
});

export const multiAgentPlugin = (): HarnessPlugin => ({
  id: "agent-harness.standard.multi-agent",
  version: "0.1.0",
  register: ({ registerTool }) => {
    registerTool("send_message_to_agent", (services) => ({
      name: "send_message_to_agent",
      description: "Send a message to a configured child agent and return its response.",
      schema: z.object({ agent_id: z.string().min(1), message: z.string().min(1) }),
      requiredServices: [CHILD_AGENT_SERVICE],
      annotations: { openWorldHint: true },
      execute: async ({ agent_id, message }, { scope, signal }) => {
        const child = await services.get(CHILD_AGENT_SERVICE).send({
          agentId: agent_id,
          message,
          scope,
          signal,
        });
        return { content: child.response, structuredContent: child as never };
      },
    }));
  },
});
