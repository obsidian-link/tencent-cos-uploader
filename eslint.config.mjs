import obsidianmd from 'eslint-plugin-obsidianmd';

export default [
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
];
