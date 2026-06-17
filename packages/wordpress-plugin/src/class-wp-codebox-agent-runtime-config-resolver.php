<?php
/**
 * Host-side agent runtime/provider/inheritance config resolution.
 *
 * @package WPCodebox
 */

defined( 'ABSPATH' ) || exit;

final class WP_Codebox_Agent_Runtime_Config_Resolver {

	private WP_Codebox_Host_Request_Normalizer $request_normalizer;
	private WP_Codebox_Host_Runtime_Config_Builder $runtime_config_builder;

	public function __construct() {
		$this->runtime_config_builder = new WP_Codebox_Host_Runtime_Config_Builder();
		$this->request_normalizer     = new WP_Codebox_Host_Request_Normalizer(
			static fn( string $path ): string => WP_Codebox_Path_Policy::clean_host_path( $path ),
			fn( array $paths ): array => $this->runtime_config_builder->existing_host_directories( $paths ),
			fn( array $input ): array => $this->runtime_config_builder->runtime_env( $input )
		);
	}

	/** @param array<string,mixed> $input Ability input. @return array<string,mixed>|WP_Error */
	public function normalize_parent_task_request( array $input ): array|WP_Error {
		return $this->request_normalizer->normalize( $input );
	}

	/** @param array<string,mixed> $input Ability input. @return array{inheritance_audit:array{connectors:array<int,array<string,mixed>>,settings:array<int,array<string,mixed>>},process_secret_env:array<string,string>} */
	public function inheritance_resolution_payload( array $input ): array {
		return $this->request_normalizer->inheritance_resolution_payload( $input );
	}

	/** @param array<string,mixed> $input Ability input. */
	public function provider( array $input ): string {
		return $this->request_normalizer->provider( $input );
	}

	/** @param array<string,mixed> $input Ability input. */
	public function model( array $input ): string {
		return $this->request_normalizer->model( $input );
	}

	/**
	 * @param callable $task_input_callback Runtime task input normalizer.
	 * @param callable $json_encode_callback JSON encoder.
	 * @param callable $task_timeout_seconds_callback Timeout normalizer.
	 * @param callable $site_seed_recipe_entries_callback Parent-site seed resolver.
	 * @return array<string,callable>
	 */
	public function recipe_adapters( callable $task_input_callback, callable $json_encode_callback, callable $task_timeout_seconds_callback, callable $site_seed_recipe_entries_callback ): array {
		return array(
			'inheritance_resolution'     => fn( array $input ): array => $this->request_normalizer->inheritance_resolution( $input ),
			'connector_credentials_error' => fn( array $inheritance ): WP_Error|null => $this->request_normalizer->connector_credentials_error( $inheritance ),
			'runtime_dependency_plan'     => fn( array $input, array $inheritance, array $component_plugins ): WP_Codebox_Runtime_Dependency_Plan => $this->request_normalizer->runtime_dependency_plan( $input, $inheritance, $component_plugins ),
			'provider_plugin_paths'       => fn( array $input, array $inheritance ): array => $this->request_normalizer->provider_plugin_paths( $input, $inheritance ),
			'agent_bundles'               => fn( array $input ): array => $this->request_normalizer->agent_bundles( $input ),
			'runtime_task'                => fn( array $input ): array => $this->request_normalizer->runtime_task( $input ),
			'task_input'                  => $task_input_callback,
			'agent_slug'                  => fn( array $input ): string => $this->request_normalizer->agent_slug( $input ),
			'mode'                        => fn( array $input ): string => $this->request_normalizer->mode( $input ),
			'provider'                    => fn( array $input, array $inheritance ): string => $this->request_normalizer->provider( $input, $inheritance ),
			'model'                       => fn( array $input, array $inheritance ): string => $this->request_normalizer->model( $input, $inheritance ),
			'json_encode'                 => $json_encode_callback,
			'task_timeout_seconds'        => $task_timeout_seconds_callback,
			'recipe_mounts'               => fn( array $input ): array|WP_Error => $this->recipe_mounts( $input ),
			'recipe_workspaces'           => fn( array $input ): array|WP_Error => $this->recipe_workspaces( $input ),
			'recipe_runtime'              => fn( array $input, string $wp_version, WP_Codebox_Runtime_Dependency_Plan $dependency_plan ): array|WP_Error => $this->recipe_runtime( $input, $wp_version, $dependency_plan ),
			'site_seed_recipe_entries'    => $site_seed_recipe_entries_callback,
			'inheritance_request'         => fn( array $input ): array => $this->request_normalizer->inheritance_request( $input ),
			'component_plugins'           => fn( array $paths ): array => $this->runtime_config_builder->component_plugins( $paths ),
			'runtime_env'                 => fn( array $input ): array => $this->request_normalizer->runtime_env( $input ),
			'secret_env_names'            => fn( array $input, array $inheritance ): array => $this->request_normalizer->secret_env_names( $input, $inheritance ),
		);
	}

	/** @param array<string,mixed> $input Ability input. @return array<int,array<string,mixed>>|WP_Error */
	private function recipe_mounts( array $input ): array|WP_Error {
		return $this->runtime_config_builder->recipe_mounts( $input );
	}

	/** @param array<string,mixed> $input Ability input. @return array<int,array<string,mixed>>|WP_Error */
	private function recipe_workspaces( array $input ): array|WP_Error {
		return $this->runtime_config_builder->recipe_workspaces( $input );
	}

	/** @param array<string,mixed> $input Ability input. @return array<string,mixed>|WP_Error */
	private function recipe_runtime( array $input, string $wp_version, ?WP_Codebox_Runtime_Dependency_Plan $dependency_plan = null ): array|WP_Error {
		return $this->runtime_config_builder->recipe_runtime( $input, $wp_version, $dependency_plan );
	}
}
