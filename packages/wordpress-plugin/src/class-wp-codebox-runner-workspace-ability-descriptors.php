<?php
/**
 * Runner workspace ability descriptors.
 *
 * @package WPCodebox
 */

defined( 'ABSPATH' ) || exit;

/**
 * Provides runner workspace ability registration descriptors.
 */
final class WP_Codebox_Runner_Workspace_Ability_Descriptors {

	/**
	 * @param array<string,mixed> $context Shared schemas assembled by WP_Codebox_Abilities.
	 * @return array<int,array<string,mixed>> Runner workspace descriptors in registration order.
	 */
	public static function descriptors( array $context ): array {
		return array(
			array(
				'canonical_ability'     => 'wp-codebox/runner-workspace-prepare',
				'aliases_before'        => array( 'wp-codebox/prepare' ),
				'aliases_after'         => array( 'wp-codebox/prepare-runner-workspace' ),
				'label'                 => 'Prepare Runner Workspace',
				'canonical_description' => 'Prepare a runner-owned workspace through the WP Codebox runner boundary using the configured workspace backend adapter.',
				'alias_description'     => 'Compatibility alias for wp-codebox/runner-workspace-prepare. Prefer the canonical WP Codebox runner workspace prepare ability in new integrations.',
				'input_schema'          => $context['prepare_input_schema'],
				'output_schema'         => $context['prepare_output_schema'],
				'execute_callback'      => array( WP_Codebox_Abilities::class, 'prepare_runner_workspace' ),
			),
			array(
				'canonical_ability'     => 'wp-codebox/runner-workspace-publish',
				'aliases_before'        => array( 'wp-codebox/publish', 'wp-codebox/publish-runner-workspace' ),
				'aliases_after'         => array(),
				'label'                 => 'Publish Runner Workspace',
				'canonical_description' => 'Publish runner-owned workspace changes through the WP Codebox runner boundary using the configured publication backend adapter.',
				'alias_description'     => 'Compatibility alias for wp-codebox/runner-workspace-publish. Prefer the canonical WP Codebox runner workspace publish ability in new integrations.',
				'input_schema'          => $context['publication_input_schema'],
				'output_schema'         => $context['publication_output_schema'],
				'execute_callback'      => array( WP_Codebox_Abilities::class, 'publish_runner_workspace' ),
			),
			array(
				'canonical_ability'     => 'wp-codebox/runner-workspace-capture',
				'aliases_before'        => array( 'wp-codebox/capture' ),
				'aliases_after'         => array( 'wp-codebox/capture-runner-workspace' ),
				'label'                 => 'Capture Runner Workspace',
				'canonical_description' => 'Capture runner-owned workspace status and diff metadata through the WP Codebox runner boundary using the configured workspace backend adapter.',
				'alias_description'     => 'Compatibility alias for wp-codebox/runner-workspace-capture. Prefer the canonical WP Codebox runner workspace capture ability in new integrations.',
				'input_schema'          => $context['capture_input_schema'],
				'output_schema'         => $context['capture_output_schema'],
				'execute_callback'      => array( WP_Codebox_Abilities::class, 'capture_runner_workspace' ),
			),
			array(
				'canonical_ability'     => 'wp-codebox/runner-workspace-command',
				'aliases_before'        => array( 'wp-codebox/command', 'wp-codebox/run-runner-workspace-command' ),
				'aliases_after'         => array(),
				'label'                 => 'Run Runner Workspace Command',
				'canonical_description' => 'Run a bounded verification or drift-check command against a runner-owned workspace through the WP Codebox runner boundary.',
				'alias_description'     => 'Compatibility alias for wp-codebox/runner-workspace-command. Prefer the canonical WP Codebox runner workspace command ability in new integrations.',
				'input_schema'          => $context['command_input_schema'],
				'output_schema'         => $context['command_output_schema'],
				'execute_callback'      => array( WP_Codebox_Abilities::class, 'run_runner_workspace_command' ),
			),
		);
	}
}
