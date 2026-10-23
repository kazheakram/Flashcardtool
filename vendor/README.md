# Vendored libraries

KaTeX is bundled into the repo so maths renders offline and no build step is needed.

| File | Source | Version |
| --- | --- | --- |
| `katex/` (`katex.min.js`, `katex.min.css`, `mhchem.min.js`, `fonts/*.woff2`) | [`katex`](https://www.npmjs.com/package/katex) `dist/` | 0.18.11 |

To rebuild:

```sh
npm install katex@0.18.11
cp node_modules/katex/dist/{katex.min.js,katex.min.css,contrib/mhchem.min.js} vendor/katex/
cp node_modules/katex/dist/fonts/*.woff2 vendor/katex/fonts/
```

The licence is in `katex/LICENSE`.
