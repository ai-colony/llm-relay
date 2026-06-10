ALTER TABLE `prompts` ADD `priority` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_prompts_status_created`;--> statement-breakpoint
CREATE INDEX `idx_prompts_status_priority_created` ON `prompts` (`status`,`priority`,`createdAt`);