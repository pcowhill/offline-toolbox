// AcroForm support via pdf-lib: reading fields, filling values and flattening.
import {
  PDFButton,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  type PDFDocument,
  type PDFField,
} from 'pdf-lib';
import type { FormFieldInfo, FormFieldType, FormValue } from './types';

function fieldType(field: PDFField): FormFieldType {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'optionlist';
  if (field instanceof PDFButton) return 'button';
  if (field instanceof PDFSignature) return 'signature';
  return 'unknown';
}

export function readFormFields(doc: PDFDocument): FormFieldInfo[] {
  let fields: PDFField[];
  try {
    fields = doc.getForm().getFields();
  } catch {
    return [];
  }
  return fields.map((field) => {
    const type = fieldType(field);
    let value: FormValue = '';
    let options: string[] = [];
    let multiline = false;
    let stateToOption: Record<string, string> | undefined;
    try {
      if (field instanceof PDFTextField) {
        value = field.getText() ?? '';
        multiline = field.isMultiline();
      } else if (field instanceof PDFCheckBox) value = field.isChecked();
      else if (field instanceof PDFRadioGroup) {
        value = field.getSelected() ?? '';
        options = field.getOptions();
        const widgets = field.acroField.getWidgets();
        if (widgets.length === options.length) {
          stateToOption = {};
          widgets.forEach((widget, i) => {
            const state = widget.getOnValue()?.decodeText();
            if (state && !(state in stateToOption!)) stateToOption![state] = options[i];
          });
        }
      } else if (field instanceof PDFDropdown) {
        value = field.getSelected()[0] ?? '';
        options = field.getOptions();
      } else if (field instanceof PDFOptionList) {
        value = field.getSelected();
        options = field.getOptions();
      }
    } catch {
      // Malformed field: show it with an empty value.
    }
    return {
      name: field.getName(),
      type,
      value,
      options,
      readOnly: field.isReadOnly(),
      multiline,
      required: field.isRequired(),
      ...(stateToOption ? { stateToOption } : {}),
    };
  });
}

export interface ApplyFormResult {
  warnings: string[];
  /** Some appearances could not be generated; viewers should regenerate them. */
  needAppearances: boolean;
}

/** Fills fields of a (copy of a) source document. Unknown or read-only fields are skipped. */
export function applyFormValues(
  doc: PDFDocument,
  values: Record<string, FormValue>,
  options: { flatten: boolean },
): ApplyFormResult {
  const warnings: string[] = [];
  let needAppearances = false;
  let form;
  try {
    form = doc.getForm();
  } catch (error) {
    return { warnings: [`Could not read the form: ${(error as Error).message}`], needAppearances };
  }
  for (const [name, value] of Object.entries(values)) {
    let field: PDFField | undefined;
    try {
      field = form.getFieldMaybe(name);
    } catch {
      field = undefined;
    }
    if (!field) {
      warnings.push(`Form field "${name}" no longer exists.`);
      continue;
    }
    try {
      if (field instanceof PDFTextField) {
        const text = String(value ?? '');
        const max = field.getMaxLength();
        if (max !== undefined && text.length > max) {
          warnings.push(`"${name}" allows at most ${max} characters; the value was shortened.`);
          field.setText(text.slice(0, max));
        } else field.setText(text);
      } else if (field instanceof PDFCheckBox) {
        if (value === true) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (typeof value === 'string' && value) field.select(value);
        else field.clear();
      } else if (field instanceof PDFDropdown) {
        if (typeof value === 'string' && value) field.select(value);
        else field.clear();
      } else if (field instanceof PDFOptionList) {
        const list = Array.isArray(value)
          ? value
          : typeof value === 'string' && value
            ? [value]
            : [];
        if (list.length) field.select(list);
        else field.clear();
      }
    } catch (error) {
      warnings.push(`Could not set "${name}": ${(error as Error).message}`);
    }
  }
  try {
    form.updateFieldAppearances();
  } catch (error) {
    needAppearances = true;
    warnings.push(
      `Some field appearances could not be generated (${(error as Error).message}). Characters outside the standard PDF font may not display in every viewer.`,
    );
  }
  if (options.flatten) {
    try {
      form.flatten({ updateFieldAppearances: false });
    } catch (error) {
      warnings.push(`The form could not be flattened completely: ${(error as Error).message}`);
    }
  }
  return { warnings, needAppearances };
}
