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
	{
		// 测试运行在 node / jsdom 中，没有 Obsidian 对 DOM 的扩展（createEl 等），
		// 并且需要直接调用设置页的 display() 来渲染
		files: ['tests/**/*.ts'],
		rules: {
			'obsidianmd/prefer-create-el': 'off',
			'@typescript-eslint/no-deprecated': 'off',
			'obsidianmd/no-global-this': 'off',
			'obsidianmd/no-tfile-tfolder-cast': 'off',
		},
	},
];
