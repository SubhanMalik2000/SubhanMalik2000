# Installing the new profile README

This replaces the current README in `SubhanMalik2000/SubhanMalik2000`.

1. In the profile repo, delete the old `README.md` and copy in everything from this folder:
   `README.md`, `assets/`, `scripts/`, `.github/workflows/readme-assets.yml`.
   (This `SETUP.md` file doesn't need to go in.)
2. Commit and push to `main`.
3. Go to the repo's **Actions** tab, open **Refresh README graphics**, and click **Run workflow**. It regenerates
   `assets/stats-*.svg` and `assets/contributions-*.svg` from live GitHub data and commits them.
   After that it runs every night on its own.
4. If the workflow fails with a permissions error: repo **Settings → Actions → General → Workflow permissions**
   → *Read and write permissions*.

Optional: to count private contributions in the graphics, turn on GitHub → Settings → Public profile →
*Include private contributions on my profile*, then add a fine-grained token as a repo secret named `README_TOKEN`.

## Also worth doing on your GitHub profile

- **Bio:** "Senior Solution Engineer at Mazik Global. React, Next.js, Power Pages and AI features for enterprise apps."
- **Location:** Karachi, Pakistan. **Website:** subhanmalikk.com (once the portfolio is deployed).
- **Pinned repos:** ai-sentinel-sdk, AgenticAi and the portfolio repo. Unpin 2021–2023 tutorial repos.
- **Before linking recruiters:** add a short README to `AgenticAi` and push the next AI Sentinel sprint, since those are the first repos people will open.

The README links to `https://subhanmalikk.com`. Until the site is live, those links won't work.
