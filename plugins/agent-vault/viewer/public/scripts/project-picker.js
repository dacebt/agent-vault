(function () {
  function create(options) {
    const { elements, escapeHTML, projectTotal, onChoose } = options;
    let projects = [];
    let selectedProject = null;
    let open = false;
    let activeIndex = -1;
    let dirty = false;

    function render() {
      elements.label.textContent = selectedProject || "No projects";
      if (open) {
        dirty = true;
        return;
      }
      dirty = false;
      elements.panel.innerHTML = projects.map((project, index) => `
        <button class="project-option" role="option" id="project-opt-${index}"
          aria-selected="${project.name === selectedProject}" data-name="${escapeHTML(project.name)}">
          <span class="project-option-name">${escapeHTML(project.name)}</span>
          <span class="project-option-count">${projectTotal(project)}</span>
        </button>`).join("");
    }

    function optionsList() {
      return [...elements.panel.querySelectorAll(".project-option")];
    }

    function setActive(index, scroll = true) {
      const optionElements = optionsList();
      if (!optionElements.length) return;
      activeIndex = Math.max(0, Math.min(index, optionElements.length - 1));
      optionElements.forEach((option, optionIndex) => {
        option.classList.toggle("active", optionIndex === activeIndex);
      });
      elements.button.setAttribute("aria-activedescendant", optionElements[activeIndex].id);
      if (scroll) optionElements[activeIndex].scrollIntoView({ block: "nearest" });
    }

    function show() {
      if (open || !projects.length) return;
      open = true;
      elements.panel.classList.remove("hidden");
      elements.button.setAttribute("aria-expanded", "true");
      setActive(Math.max(0, projects.findIndex((project) => project.name === selectedProject)));
    }

    function close() {
      if (!open) return;
      open = false;
      activeIndex = -1;
      elements.panel.classList.add("hidden");
      elements.button.setAttribute("aria-expanded", "false");
      elements.button.removeAttribute("aria-activedescendant");
      if (dirty) render();
    }

    function choose(name) {
      close();
      onChoose(name);
      elements.button.focus();
    }

    function update(projectList, currentProject) {
      projects = projectList;
      selectedProject = currentProject;
      render();
    }

    elements.button.addEventListener("click", () => (open ? close() : show()));
    elements.button.addEventListener("keydown", (event) => {
      if (!open) {
        if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          show();
        }
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive(activeIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive(activeIndex - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        setActive(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setActive(projects.length - 1);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const option = optionsList()[activeIndex];
        if (option) choose(option.dataset.name);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") {
        close();
      }
    });

    elements.panel.addEventListener("click", (event) => {
      const option = event.target.closest(".project-option");
      if (option) choose(option.dataset.name);
    });

    document.addEventListener("click", (event) => {
      if (open && !elements.wrapper.contains(event.target)) close();
    });

    return Object.freeze({
      close,
      isOpen() {
        return open;
      },
      update,
    });
  }

  window.projectPicker = Object.freeze({ create });
}());
