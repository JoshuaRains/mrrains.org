const videos = [
  {
    src: "./media/mtcKMbltrRA.mp4",
    title: "La tortilla más cara del mundo"
  },
  {
    src: "./media/mMy_aFoXtQo.mp4",
    title: "El mejor escudo antirradiación"
  },
  {
    src: "./media/qkT-593VcuU.mp4",
    title: "Un consejo para cada tipo de dolor de cabeza"
  },
  {
    src: "./media/aWKV_UxK4_o.mp4",
    title: "Rubius se da cuenta de que ya tiene 36 años"
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
