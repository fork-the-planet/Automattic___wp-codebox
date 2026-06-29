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
				'label'                 => 'Prepare Runner Workspace',
				'canonical_description' => 'Prepare a runner-owned workspace through the WP Codebox runner boundary using the configured workspace backend adapter.',
				'input_schema'          => $context['prepare_input_schema'],
				'output_schema'         => $context['prepare_output_schema'],
				'execute_callback'      => array( WP_Codebox_Abilities::class, 'prepare_runner_workspace' ),
			),
			array(
				'canonical_ability'     => 'wp-codebox/runner-workspace-publish',
				'label'                 => 'Publish Runner Workspace',
				'canonical_description' => 'Publish runner-owned workspace changes through the WP Codebox runner boundary using the configured publication backend adapter.',
				'input_schema'          => $context['publication_input_schema'],
				'output_schema'         => $context['publication_output_schema'],
				'execute_callback'      => array( WP_Codebox_Abilities::class, 'publish_runner_workspace' ),
			),
			array(
				'canonical_ability'     => 'wp-codebox/runner-workspace-capture',
				'label'                 => 'Capture Runner Workspace',
				'canonical_description' => 'Capture runner-owned workspace status and diff metadata through the WP Codebox runner boundary using the configured workspace backend adapter.',
				'input_schema'          => $context['capture_input_schema'],
				'output_schema'         => $context['capture_output_schema'],
				'execute_callback'      => array( WP_Codebox_Abilities::class, 'capture_runner_workspace' ),
			),
			array(
				'canonical_ability'     => 'wp-codebox/runner-workspace-command',
				'label'                 => 'Run Runner Workspace Command',
				'canonical_description' => 'Run a bounded verification or drift-check command against a runner-owned workspace through the WP Codebox runner boundary.',
				'input_schema'          => $context['command_input_schema'],
				'output_schema'         => $context['command_output_schema'],
				'execute_callback'      => array( WP_Codebox_Abilities::class, 'run_runner_workspace_command' ),
			),
		);
	}
}
