(function () {
  function attach(svg, onActivate) {
    const nodeElements = new Map([...svg.querySelectorAll(".graph-node")]
      .map((node) => [node.dataset.id, node]));

    function activate(event, node) {
      if (event.type === "keydown") {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (event.repeat) return;
      }

      onActivate(node.resource);
    }

    nodeElements.forEach((element, id) => {
      const node = svg.__graphNodes.get(id);
      element.addEventListener("click", (event) => activate(event, node));
      element.addEventListener("keydown", (event) => activate(event, node));
    });
  }

  window.graphInteraction = Object.freeze({ attach });
})();
