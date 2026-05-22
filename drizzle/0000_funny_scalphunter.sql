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
	`reasoning` text,
	`response` text,
	`reasoningTime` integer,
	`reasoningTokenPerSecond` integer,
	`responseTime` integer,
	`responseTokenPerSecond` integer
);
