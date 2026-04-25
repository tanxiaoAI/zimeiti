(async () => {
  const url = "https://www.xiaohongshu.com/explore/69c4bee8000000001b023af5?xsec_token=ABWvkuWUBEDwtEO6GwVSZDQ9u3aRNCQnoOv0TZmALzoss=&xsec_source=pc_user";
  try {
    const res = await fetch("https://videoparser2.p.rapidapi.com/api/media", {
      method: "POST",
      headers: {
        "x-rapidapi-key": "079b6bc2f2msh2d9995646bf2483p190e49jsndf0d32e9281c",
        "x-rapidapi-host": "videoparser2.p.rapidapi.com",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url })
    });
    console.log("Status:", res.status);
    console.log("Body:", await res.text());
  } catch (e) {
    console.error(e);
  }
})();
