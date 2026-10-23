# Vendored libraries

These are bundled into the repo so the app works offline as an installed app and needs no build step.

| File | Source | Version |
| --- | --- | --- |
| `katex/` (`katex.min.js`, `katex.min.css`, `mhchem.min.js`, `fonts/*.woff2`) | [`katex`](https://www.npmjs.com/package/katex) `dist/` | 0.18.11 |
| `anthropic-sdk.mjs` | [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk), bundled to one ES module | 0.132.1 |

To rebuild them:

```sh
npm install katex@0.18.11 @anthropic-ai/sdk@0.132.1 esbuild
cp node_modules/katex/dist/{katex.min.js,katex.min.css,contrib/mhchem.min.js} vendor/katex/
cp node_modules/katex/dist/fonts/*.woff2 vendor/katex/fonts/
echo 'export { default } from "@anthropic-ai/sdk";' > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --minify --platform=browser --outfile=vendor/anthropic-sdk.mjs
```

Their licences are in `katex/LICENSE` and `anthropic-sdk.LICENSE`.
