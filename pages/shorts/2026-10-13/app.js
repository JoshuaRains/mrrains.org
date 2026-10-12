const videos = [
  {
    src: "./media/JNesicKQ8nE.mp4",
    title: "Three levels of chocolate chip cookies"
  },
  {
    src: "./media/46WqMxjdzOk.mp4",
    title: "Nasal dilators"
  },
  {
    src: "./media/_qLDSX6K06s.mp4",
    title: "La comida que no inventó mi mamá"
  }
];

const listElement = document.getElementById("video-list");

videos.forEach((videoData, index) => {
  const section = document.createElement("section");
  section.className = "video-section";

  const heading = document.createElement("h2");
  heading.textContent = `Video ${index + 1}`;

  const frame = document.createElement("div");
  frame.className = "video-frame";

  const video = document.createElement("video");
  video.src = videoData.src;
  video.title = `Video ${index + 1}: ${videoData.title}`;
  video.controls = true;
  video.preload = "metadata";
  video.playsInline = true;

  frame.append(video);
  section.append(heading, frame);
  listElement.append(section);
});
