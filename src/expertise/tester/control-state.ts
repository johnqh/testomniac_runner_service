export interface ControlState {
  selector: string;
  tagName: string;
  role?: string;
  inputType?: string;
  inputMode?: string;
  name?: string;
  label?: string;
  groupName?: string;
  groupKey?: string;
  formContext?: string;
  disabled: boolean;
  readOnly: boolean;
  required: boolean;
  visible: boolean;
  checked: boolean;
  selected: boolean;
  value: string;
  selectedValues: string[];
  invalid: boolean;
  validationMessage?: string;
  expanded?: boolean;
  passwordMasked: boolean;
  hasPasswordRevealControl: boolean;
}

export function findControlBySelector(
  states: ControlState[],
  selector?: string
): ControlState | undefined {
  if (!selector) return undefined;
  return states.find(state => state.selector === selector);
}

export function findControlPeers(
  states: ControlState[],
  target?: ControlState
): ControlState[] {
  if (!target?.groupKey) return [];
  return states.filter(state => state.groupKey === target.groupKey);
}

export function normalizeWhitespace(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function digitsOnly(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function classifyControlKind(control?: ControlState): string {
  if (!control) return "unknown";
  const role = (control.role ?? "").toLowerCase();
  const inputType = (control.inputType ?? "").toLowerCase();

  if (role === "tab") return "tab";
  if (control.expanded != null) return "disclosure";
  if (role === "switch") return "switch";
  if (role === "radio" || inputType === "radio") return "radio";
  if (role === "checkbox" || inputType === "checkbox") return "checkbox";
  if (role === "combobox" || control.tagName === "SELECT") return "select";
  if (inputType === "password") return "password";
  if (inputType === "tel") return "phone";
  if (inputType === "date") return "date";
  if (inputType === "number") return "number";
  if (control.tagName === "TEXTAREA") return "textarea";
  return "text";
}
