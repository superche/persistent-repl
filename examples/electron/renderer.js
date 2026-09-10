const $ = (id) => document.getElementById(id);
const write = (id, value) => {
  const p = document.createElement("pre");
  p.textContent = JSON.stringify(value, null, 2);
  $(id).appendChild(p);
  while ($(id).children.length > 12) $(id).firstChild.remove();
};
const image = (id, data) => {
  const img = document.createElement("img");
  img.src = "data:image/png;base64," + data;
  $(id).appendChild(img);
};
window.replHost.onModel((e) => {
  if (e.type === "image") image("model", e.data);
  else write("model", e.type === "text" ? e.text : e.value);
});
window.replHost.onPreview((e) => {
  if (e.type === "stopped") {
    $("preview").textContent = "Preview stopped";
    return;
  }
  if (e.observation?.image) image("preview", e.observation.image.data);
});
for (const action of ["run", "stop", "reset", "dispose"])
  $(action).onclick = async () => {
    try {
      const r = await window.replHost.control(
        action === "run" ? "execute" : action,
        action === "run" ? $("code").value : undefined,
      );
      $("result").textContent = JSON.stringify(
        r,
        (key, value) => (key === "data" ? "[image bytes]" : value),
        2,
      );
    } catch (e) {
      $("result").textContent = String(e);
    }
  };
setInterval(async () => {
  try {
    $("state").textContent = (await window.replHost.control("status")).state;
  } catch {}
}, 300);
