const projectSelection = {
  fromUrl(projectList) {
    const name = new URLSearchParams(location.search).get("project");
    return this.isAllowed(projectList, name) ? name : null;
  },

  first(projectList) {
    return projectList[0] ? projectList[0].name : null;
  },

  isAllowed(projectList, name) {
    return Boolean(name) && projectList.some((project) => project.name === name);
  },

  resolve(projectList) {
    return this.fromUrl(projectList) || this.first(projectList);
  },

  push(name) {
    if (new URLSearchParams(location.search).get("project") === name) return;
    const url = new URL(location.href);
    url.searchParams.set("project", name);
    history.pushState(null, "", url);
  },
};
