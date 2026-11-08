Physical AI Lab — MBZUAI

Public website: https://engbaa.github.io/physical-ai-lab/

Explore the segmented point cloud and animated scene graph of the Physical AI
Lab at Mohamed bin Zayed University of Artificial Intelligence.

The website includes the complete current scan (13,681,148 points), 248 object
annotations, search, selection, labels, RGB/segment colours, focus/isolation,
object previews, annotation downloads and an animated lab hierarchy. The graph
retains the established display configuration of 245 objects, nine areas and
five chambers. Its floor connectivity and saved spatial links can be inspected.

DOWNLOAD THE ANIMATED SCENE GRAPH

Open Scene Graph, select a label, then press the download-arrow button at the
right of the animation controls. It saves a 1920 x 1080 video (WebM, or MP4 when
that is the browser's supported format). The 5.2-second graph animation replays
with that selection and its highlighted connections, then holds the complete
graph for two seconds. Text labels and the current scan, map and spatial-link
visibility settings are included. When a label is selected, its visible details
panel appears beside the graph, including the description, affordances, saved
relationships and animated Generated view or 3D scan. Paused previews stay paused;
the panel's scroll position and expanded sections are retained in the recording.
The current viewing direction is retained,
with framing widened to include the whole graph. Your original camera, selection
and playback position are restored afterward. Keep the tab visible while it
records; Cancel or Escape discards the recording. This is a visual video export;
the separate Export menu continues to offer the original data files.

Data snapshot: 5 November 2026. The point cloud, source annotations and original
scene graph are unchanged from the local standalone viewer. Large saved GIF
previews are encoded as animated WebP at quality 90 for GitHub Pages. Dimensions,
frame counts and timing are checked during conversion. This conversion is lossy;
it affects only preview images. Original preview hashes are retained in the
preview index. All scan points, object masks and 3D previews are preserved.

The aligned map is a saved snapshot. This viewer does not run live robot
telemetry, a physics simulator, or the SONIC controller.

The full-resolution cloud has a substantial initial download. Use a browser
with WebGL2 and hardware acceleration, preferably on a desktop computer.

LOCAL DEVELOPMENT

    npm ci
    npm test
    npm run dev

Node.js 24 is used by the deployment workflow. To serve a local production build:

    npm run build
    bash run.sh

Open http://localhost:4175. Python 3.9+ is required for this optional server.

PUBLICATION

GitHub Pages uses GitHub Actions. Pushes to main run the data/model checks,
build with the repository URL prefix, validate the published asset sizes and
references, and deploy dist/. The .github/workflows/pages.yml workflow can also
be run manually. Secrets, dependency folders and local logs are excluded.

To reproduce the project-prefix build locally:

    SITE_BASE=/physical-ai-lab/ npm run build
    bash run.sh --base-path /physical-ai-lab/

Then open http://localhost:4175/physical-ai-lab/.

The saved dataset is bundled under public/data/. No external lab server or API
is required. scripts/optimize_previews.py is an optional maintenance tool for
encoding the original GIFs; it requires Pillow and the original preview folder.
Existing encoded assets can be used directly without that tool.

Third-party Three.js and font notices are included under public/licenses/ and
in the built website. Public availability does not assign a new license to the
lab's source code, branding or captured data.
