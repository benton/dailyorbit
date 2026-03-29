# Code Organization Rules

**IMPORTANT**: All high-level User UI actions - that is, at a minimum, anything that _corresponds to a User story_ or _modifies the state of the system_ - should be implemented as a Services layer method, with a corresponding API method. The general principle is that anything a User can do through the UI should be easily automatable by driving a simple, high-level API call. Think hard and ask any necessary questions when considering this rule and its implications.

- Any complex command that needs to be run repeatedly should be a `./daily-orbit` CLI subcommand.
- Place code in `packages/[server|web]/src/[module name]` as per the standard ES modules layout.
- Place deployment-related code in `deploy`
- Place documentation in `doc`
- Place short-term, development-only scripts in `scripts` - permanent application tooling should be integrated into the appliction's CLI. If a script needs to access app modules, if should be a CLI subcommand because transitive imports may fail.
