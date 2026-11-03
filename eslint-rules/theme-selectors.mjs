/** Selector pieces shared by the theme rules: which elements count as a "control". */
export const CONTROLS = "/^(Button|IconButton|Input|Textarea)$/";
export const MEMBER_CONTROLS =
  "JSXOpeningElement[name.type='JSXMemberExpression'][name.object.name=/^(NativeSelect|Dialog|Tabs)$/][name.property.name=/^(Field|Content|Trigger)$/]";
