CREATE TABLE `team_context` (
	`team_id` text PRIMARY KEY NOT NULL,
	`country` text,
	`flag_url` text,
	`league_code` text,
	`league_name` text,
	`league_position` integer,
	`league_played` integer,
	`league_points` integer,
	`ucl_position` integer,
	`ucl_played` integer,
	`ucl_points` integer,
	`form` text,
	`refreshed_at` integer,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
