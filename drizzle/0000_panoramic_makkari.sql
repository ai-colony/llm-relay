CREATE TABLE `prompts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`clientName` text NOT NULL,
	`requestId` integer NOT NULL,
	`callbackUrl` text,
	`callbackCompleted` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`status` text NOT NULL,
	`statusError` text,
	`completedAt` integer,
	`systemPrompt` text,
	`userPrompt` text NOT NULL,
	`temperature` real NOT NULL,
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
CREATE INDEX `idx_prompts_status` ON `prompts` (`status`);--> statement-breakpoint
CREATE INDEX `idx_prompts_callback` ON `prompts` (`callbackCompleted`,`status`);--> statement-breakpoint
CREATE INDEX `idx_prompts_status_created` ON `prompts` (`status`,`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_prompts_client_request` ON `prompts` (`clientName`,`requestId`);