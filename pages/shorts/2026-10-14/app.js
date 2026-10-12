const videos = [
  {
    src: "./media/mtcKMbltrRA.mp4",
    title: "La tortilla más cara del mundo"
  },
  {
    src: "./media/CzEKLLMw-_k.mp4",
    title: "Restricción del uso de celulares en las escuelas"
  },
  {
    src: "./media/vs6_Nyns3tI.mp4",
    title: "Choripán al estilo peruano"
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
