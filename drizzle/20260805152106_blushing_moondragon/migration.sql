CREATE TABLE `embeddings` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`clientName` text NOT NULL,
	`requestId` text NOT NULL,
	`callbackUrl` text,
	`callbackCompleted` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`status` text NOT NULL,
	`statusError` text,
	`completedAt` integer,
	`input` text NOT NULL,
	`inputCount` integer NOT NULL,
	`encodingFormat` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`retryCount` integer NOT NULL,
	`nextRetryAt` integer,
	`model` text,
	`dimensions` integer,
	`vectors` blob,
	`durationMs` integer
);
--> statement-breakpoint
CREATE INDEX `idx_embeddings_callback` ON `embeddings` (`status`,`callbackCompleted`,`callbackUrl`);--> statement-breakpoint
CREATE INDEX `idx_embeddings_status_priority_created` ON `embeddings` (`status`,`priority`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_embeddings_client_created` ON `embeddings` (`clientName`,`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_embeddings_client_request` ON `embeddings` (`clientName`,`requestId`);