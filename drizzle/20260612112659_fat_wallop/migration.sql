CREATE TABLE `prompts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`clientName` text NOT NULL,
	`requestId` text NOT NULL,
	`callbackUrl` text,
	`callbackCompleted` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`status` text NOT NULL,
	`statusError` text,
	`completedAt` integer,
	`systemPrompt` text,
	`userPrompt` text NOT NULL,
	`temperature` real NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`retryCount` integer NOT NULL,
	`nextRetryAt` integer,
	`reasoning` text,
	`response` text,
	`reasoningTimeMs` integer,
	`reasoningTokenPerSecond` integer,
	`responseTimeMs` integer,
	`responseTokenPerSecond` integer
);
--> statement-breakpoint
CREATE INDEX `idx_prompts_callback` ON `prompts` (`status`,`callbackCompleted`,`callbackUrl`);--> statement-breakpoint
CREATE INDEX `idx_prompts_status_priority_created` ON `prompts` (`status`,`priority`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_prompts_client_created` ON `prompts` (`clientName`,`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_prompts_client_request` ON `prompts` (`clientName`,`requestId`);