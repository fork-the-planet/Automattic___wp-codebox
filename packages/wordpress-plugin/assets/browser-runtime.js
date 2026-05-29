( () => {
	const defaultRunnerDir = '/wordpress/wp-content/uploads/wp-codebox/runner';
	const defaultRunnerUrlBase = '/wp-content/uploads/wp-codebox/runner';

	const safeName = ( name ) => String( name || 'task' ).replace( /[^a-z0-9_-]/gi, '-' ).toLowerCase();

	const responseText = ( response ) => {
		if ( typeof response === 'string' ) {
			return response;
		}

		return typeof response?.text === 'string' ? response.text : '';
	};

	const parseJsonResponse = ( response ) => {
		const text = responseText( response );
		const start = text.indexOf( '{' );
		const end = text.lastIndexOf( '}' );
		if ( start === -1 || end === -1 || end < start ) {
			throw new Error( 'WP Codebox browser runner did not return JSON.' );
		}

		return JSON.parse( text.slice( start, end + 1 ) );
	};

	const runPhpRequest = async ( client, options = {} ) => {
		if ( ! client || typeof client.request !== 'function' ) {
			throw new Error( 'Playground request handler is unavailable.' );
		}

		const code = String( options.code || '' );
		if ( ! code ) {
			throw new Error( 'PHP code is required.' );
		}

		const runnerDir = String( options.runnerDir || defaultRunnerDir );
		const runnerUrlBase = String( options.runnerUrlBase || defaultRunnerUrlBase );
		const filename = `${ safeName( options.name ) }-${ Date.now() }-${ Math.random().toString( 36 ).slice( 2, 8 ) }.php`;
		const scriptPath = `${ runnerDir }/${ filename }`;
		const requestUrl = `${ runnerUrlBase }/${ filename }`;

		if ( typeof client.mkdir === 'function' ) {
			await client.mkdir( runnerDir );
		}
		await client.writeFile( scriptPath, code );

		const response = await client.request( {
			method: 'GET',
			url: requestUrl,
		} );

		return options.expectJson ? parseJsonResponse( response ) : response;
	};

	const runRecipe = async ( client, recipe, taskPayload, options = {} ) => {
		const taskPath = recipe?.browser?.task_path;
		const steps = Array.isArray( recipe?.workflow?.steps ) ? recipe.workflow.steps : [];
		if ( ! taskPath || steps.length === 0 ) {
			throw new Error( 'WP Codebox browser recipe missing.' );
		}

		await client.writeFile( taskPath, JSON.stringify( taskPayload ) );

		let lastResult = null;
		for ( const step of steps ) {
			if ( step?.command !== 'wordpress.run-php' ) {
				throw new Error( `Unsupported browser recipe step: ${ step?.command || 'unknown' }` );
			}

			const codeArg = ( step.args || [] ).find( ( arg ) => typeof arg === 'string' && arg.startsWith( 'code=' ) );
			if ( ! codeArg ) {
				throw new Error( 'Browser recipe PHP step missing code argument.' );
			}

			lastResult = await runPhpRequest( client, {
				...options,
				code: codeArg.slice( 5 ),
				name: options.name || 'codebox-recipe',
				expectJson: true,
			} );
			if ( ! lastResult.success ) {
				throw new Error( lastResult?.error?.message || 'WP Codebox browser recipe step failed.' );
			}
		}

		return lastResult;
	};

	window.wpCodeboxBrowser = {
		parseJsonResponse,
		runPhpRequest,
		runRecipe,
	};
} )();
