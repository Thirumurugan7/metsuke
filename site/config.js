/*
 * Deployment settings for the static site.
 *
 * Separate from roadmap.js so that pointing the checklist at a backend is a one-line edit
 * to a file with nothing else in it, rather than a change inside application code.
 *
 * Leave it empty and the roadmap keeps its ticks in this browser only, which is how it
 * behaved before any of this existed and is a perfectly good place to stay.
 */
window.METSUKE_ROADMAP_API = 'https://metsuke-server.vercel.app/api/roadmap'

/*
 * Where installers come from.
 *
 * The code repository is private, so its release assets cannot be linked directly: they
 * need an authenticated request. The download endpoint on the telemetry deployment makes
 * that request with a read-only token and returns the signed URL GitHub replies with, so
 * the bytes still travel browser-to-GitHub and nothing has to be made public.
 *
 * Set it to that deployment's /download. Empty means the download buttons say there is no
 * release yet, which is true until one exists.
 */
window.METSUKE_DOWNLOAD_API = 'https://metsuke-server.vercel.app/download'
