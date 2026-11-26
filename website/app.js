const reactionLabels = {
  fine: "This Is Fine. For when everything definitely isn’t.",
  drake: "Drake. A very clear preference.",
  distracted: "Distracted Boyfriend. Ooh, something new.",
};
const demoInput = document.querySelector("#demo-search");
const reactions = [...document.querySelectorAll(".reaction")];
function selectReaction(button) {
  reactions.forEach((item) => {
    item.classList.toggle("selected", item === button);
    item.setAttribute("aria-pressed", String(item === button));
  });
  document.querySelector("#demo-result span:last-child").textContent =
    reactionLabels[button.dataset.reaction];
  document.querySelector("#demo-source").href = button.dataset.image;
}
reactions.forEach((button) =>
  button.addEventListener("click", () => selectReaction(button)),
);
demoInput.addEventListener("input", () => {
  const query = demoInput.value.toLowerCase().trim();
  const stopWords = new Set([
    "the",
    "that",
    "when",
    "with",
    "and",
    "for",
    "are",
    "was",
    "but",
    "not",
    "have",
    "has",
    "this",
    "meme",
  ]);
  const words = query
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
  const matching = reactions.filter(
    (button) =>
      !words.length ||
      words.some((word) =>
        button.dataset.keywords
          .split(" ")
          .some((keyword) => keyword.startsWith(word)),
      ),
  );
  reactions.forEach((button) => {
    button.hidden = !matching.includes(button);
  });
  document.querySelector("#demo-empty").hidden = matching.length > 0;
});
demoInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const first = reactions.find((button) => !button.hidden);
    if (first) selectReaction(first);
  }
  if (event.key === "Escape") {
    demoInput.value = "";
    demoInput.dispatchEvent(new Event("input"));
  }
});

const platform = /mac/i.test(
  navigator.userAgentData?.platform || navigator.platform,
)
  ? "macos"
  : /win/i.test(navigator.userAgentData?.platform || navigator.platform)
    ? "windows"
    : /linux/i.test(navigator.userAgentData?.platform || navigator.platform) &&
        !/android/i.test(navigator.userAgent)
      ? "linux"
      : null;
if (platform) {
  const card = document.querySelector(`[data-platform="${platform}"]`);
  card.classList.add("recommended");
  const badge = document.createElement("span");
  badge.className = "recommended-badge";
  badge.textContent = "YOUR PLATFORM";
  card.append(badge);
}
function unavailable(message) {
  document.querySelector("#release-status").textContent = message;
  document.querySelectorAll(".availability").forEach((item) => {
    item.textContent = "See GitHub for availability";
  });
}
async function loadRelease() {
  try {
    const response = await fetch("/api/releases", {
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("Release lookup failed");
    const release = await response.json();
    if (!release.available) {
      unavailable("Preview builds are being prepared");
      document.querySelector("#release-note").textContent =
        "Build from source now, or check GitHub for the first downloadable preview.";
      return;
    }
    document.querySelector("#release-status").textContent =
      `${release.version} · ${release.channel === "preview" ? "Preview release" : "Latest stable release"}`;
    document.querySelector("#release-link").href = release.url;
    document.querySelector("#release-note").textContent =
      release.channel === "preview"
        ? "Early preview. Read the compatibility notes before installing."
        : "Installers are served directly from the public GitHub release.";
    if (release.checksums) {
      const link = document.querySelector("#checksum-link");
      link.href = release.checksums;
      link.hidden = false;
    }
    for (const card of document.querySelectorAll(".download-card")) {
      const container = card.querySelector(".asset-links");
      container.replaceChildren();
      const assets = release.assets.filter(
        (asset) => asset.platform === card.dataset.platform,
      );
      if (!assets.length) {
        const text = document.createElement("span");
        text.className = "availability";
        text.textContent = "No build in this release";
        container.append(text);
        continue;
      }
      for (const asset of assets) {
        const link = document.createElement("a");
        link.className = "download-asset";
        link.href = asset.url;
        const arch =
          asset.platform === "macos"
            ? { arm64: "Apple Silicon", x64: "Intel", universal: "Universal" }[
                asset.architecture
              ]
            : asset.architecture === "arm64"
              ? "ARM64"
              : "x64";
        link.textContent = `${arch} · ${asset.format}`;
        link.setAttribute(
          "aria-label",
          `Download MemeIT for ${card.querySelector("h3").textContent}, ${arch}, ${asset.format}, ${(asset.size / 1048576).toFixed(1)} MB`,
        );
        link.title = `${asset.name} · ${(asset.size / 1048576).toFixed(1)} MB`;
        container.append(link);
      }
    }
  } catch {
    unavailable("Check GitHub for the latest builds");
    document.querySelector("#release-note").textContent =
      "The live build list is unavailable. GitHub Releases has the current downloads and release notes.";
  }
}
loadRelease();
