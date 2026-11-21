/**
 * The name of a record's title field in a page test: "Edit title" for a rename, the prompt of the
 * page ("New company") for a title still to give (`EditableTitle`), which the mocked `t` returns as its key.
 */
export const TITLE_FIELD = /^(common:buttons\.editTitle|.*\.(new[A-Za-z]*|newTitle|titlePlaceholder|title\.(?:new|placeholder)|add[A-Za-z]*))$/;
