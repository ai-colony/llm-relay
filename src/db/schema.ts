import { Table } from '@andrewitsover/midnight';

export type PromptStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'failed_retry';
class Prompt extends Table {
  clientName = this.Text;
  requestId = this.Int;
  callbackUrl = this.Null.Text;
  callbackCompleted = this.Bool;

  createdAt = this.Now.Instant;
  status = this.Index(this.Text);
  statusError = this.Null.Text;
  completedAt = this.Null.Now;

  systemPrompt = this.Null.Text;
  userPrompt = this.Text;

  reasoning = this.Null.Text;
  response = this.Null.Text;
  reasoningTime = this.Null.Int;
  reasoningTokenPerSecond = this.Null.Int;
  responseTime = this.Null.Int;
  responseTokenPerSecond = this.Null.Int;

  Attributes = () => {
    this.Unique(this.requestId, this.clientName);
  };
}

export const schema = {
  Prompt
};
