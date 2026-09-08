CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`pool_id` text,
	`action` text NOT NULL,
	`target` text,
	`before` text,
	`after` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_pool_idx` ON `audit_log` (`pool_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`request_ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_tokens_hash_idx` ON `auth_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_tokens_user_idx` ON `auth_tokens` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `competitions` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_code` text NOT NULL,
	`season` text NOT NULL,
	`display_tz` text DEFAULT 'America/New_York' NOT NULL,
	`first_kickoff_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contests` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`kind` text NOT NULL,
	`fixture_id` text,
	`tie_id` text,
	`side_a_team_id` text NOT NULL,
	`side_b_team_id` text NOT NULL,
	`locks_at` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`outcome` text,
	`settled_at` integer,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fixture_id`) REFERENCES `fixtures`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tie_id`) REFERENCES `ties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`side_a_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`side_b_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contests_exactly_one_target" CHECK(("contests"."fixture_id" IS NULL) <> ("contests"."tie_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `contests_round_idx` ON `contests` (`round_id`);--> statement-breakpoint
CREATE INDEX `contests_locks_idx` ON `contests` (`locks_at`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `contests_fixture_idx` ON `contests` (`fixture_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contests_tie_idx` ON `contests` (`tie_id`);--> statement-breakpoint
CREATE TABLE `fixtures` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`tie_id` text,
	`leg` integer,
	`provider_fixture_id` integer NOT NULL,
	`home_team_id` text NOT NULL,
	`away_team_id` text NOT NULL,
	`kickoff_at` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`home_score_90` integer,
	`away_score_90` integer,
	`home_score_ft` integer,
	`away_score_ft` integer,
	`home_pens` integer,
	`away_pens` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`home_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`away_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fixtures_provider_idx` ON `fixtures` (`provider_fixture_id`);--> statement-breakpoint
CREATE INDEX `fixtures_round_idx` ON `fixtures` (`round_id`);--> statement-breakpoint
CREATE INDEX `fixtures_tie_idx` ON `fixtures` (`tie_id`);--> statement-breakpoint
CREATE INDEX `fixtures_kickoff_idx` ON `fixtures` (`kickoff_at`,`status`);--> statement-breakpoint
CREATE TABLE `odds_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`contest_id` text NOT NULL,
	`bookmaker` text NOT NULL,
	`captured_at` integer NOT NULL,
	`is_locked` integer DEFAULT false NOT NULL,
	`side_a_point` real NOT NULL,
	`side_b_point` real NOT NULL,
	`side_a_price` real,
	`side_b_price` real,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `odds_contest_idx` ON `odds_snapshots` (`contest_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `odds_locked_idx` ON `odds_snapshots` (`contest_id`) WHERE "odds_snapshots"."is_locked" = 1;--> statement-breakpoint
CREATE TABLE `picks` (
	`id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`user_id` text NOT NULL,
	`contest_id` text NOT NULL,
	`selection` text NOT NULL,
	`line_at_pick` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`locked_at` integer,
	`is_correct` integer,
	`points_awarded` integer,
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `picks_unique_idx` ON `picks` (`pool_id`,`user_id`,`contest_id`);--> statement-breakpoint
CREATE INDEX `picks_contest_idx` ON `picks` (`contest_id`);--> statement-breakpoint
CREATE INDEX `picks_pool_user_idx` ON `picks` (`pool_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `pool_members` (
	`pool_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`display_name` text,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`pool_id`, `user_id`),
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pool_members_user_idx` ON `pool_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `pools` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`invite_code` text NOT NULL,
	`join_password_hash` text NOT NULL,
	`pick_mode` text NOT NULL,
	`mode_locked` integer DEFAULT false NOT NULL,
	`competition_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`join_closes_at` integer NOT NULL,
	`tiebreakers` text DEFAULT '["points","knockout_correct","latest_round","submitted_earliest"]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pools_slug_idx` ON `pools` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `pools_invite_idx` ON `pools` (`invite_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `pools_name_idx` ON `pools` (lower("name"));--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`points_per_pick` integer NOT NULL,
	`sequence` integer NOT NULL,
	`picks_open_at` integer,
	`odds_lock_at` integer,
	`first_kickoff_at` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rounds_comp_code_idx` ON `rounds` (`competition_id`,`code`);--> statement-breakpoint
CREATE INDEX `rounds_sequence_idx` ON `rounds` (`competition_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `standings_rounds` (
	`pool_id` text NOT NULL,
	`user_id` text NOT NULL,
	`round_id` text NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`cumulative_points` integer DEFAULT 0 NOT NULL,
	`rank` integer,
	`picks_made` integer DEFAULT 0 NOT NULL,
	`picks_possible` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`pool_id`, `user_id`, `round_id`),
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `standings_pool_round_idx` ON `standings_rounds` (`pool_id`,`round_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_team_id` integer NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`crest_url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_provider_idx` ON `teams` (`provider_team_id`);--> statement-breakpoint
CREATE TABLE `ties` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`team_a_id` text NOT NULL,
	`team_b_id` text NOT NULL,
	`single_leg` integer DEFAULT false NOT NULL,
	`leg1_fixture_id` text,
	`leg2_fixture_id` text,
	`agg_a` integer,
	`agg_b` integer,
	`winner_team_id` text,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_a_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_b_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`winner_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ties_round_idx` ON `ties` (`round_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ties_round_pair_idx` ON `ties` (`round_id`,`team_a_id`,`team_b_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`username` text,
	`password_hash` text,
	`email_verified_at` integer,
	`timezone` text DEFAULT 'America/New_York' NOT NULL,
	`notif_prefs` text DEFAULT '{"reminders":true,"digests":true}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_idx` ON `users` (lower("username"));