export const basePath = import.meta.env.BASE_URL || "/stock-insight/";
export const repositoryUrl = "https://github.com/chjs207/stock-insight";
export const workflowUrl = repositoryUrl + "/actions/workflows/update.yml";
export function appHref(query = "") { return basePath + query; }
