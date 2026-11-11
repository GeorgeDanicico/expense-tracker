import rule from "./dnd-context-id.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const error = { messageId: "missing" };

createRuleTester().run("dnd-context-id", rule, {
  valid: [
    `const a = <DndContext id="todo-board" sensors={sensors}>x</DndContext>`,
    `const a = <DndContext sensors={sensors} id={boardId}>x</DndContext>`,
    `const a = <DndContext {...props}>x</DndContext>`,
    `const a = <Other>x</Other>`,
  ],
  invalid: [
    { code: `const a = <DndContext sensors={sensors}>x</DndContext>`, errors: [error] },
    { code: `const a = <DndContext />`, errors: [error] },
  ],
});
