"use client";
import {
  useCallback,
  useId,
  type SetStateAction,
  type InputHTMLAttributes,
} from "react";
import {
  Controller,
  useForm,
  useWatch,
  type DefaultValues,
  type FieldValues,
  type Path,
  type PathValue,
  type Resolver,
  type UseFormProps,
  type UseFormHandleSubmit,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useI18n } from "./locale-context";
import { formErrorMap } from "@/lib/form-schemas";

// All client forms use the same validation timing and server-owned Zod rules.
// These schemas retain their input types (e.g. trim returns a string).
export function useSchemaForm<T extends FieldValues>(
  schema: z.ZodType<T, FieldValues>,
  defaultValues: DefaultValues<NoInfer<T>>,
  options: Pick<UseFormProps<T>, "mode"> = {},
) {
  const form = useForm<T>({
    resolver: zodResolver(schema, { error: formErrorMap }) as Resolver<T>,
    defaultValues,
    mode: "onSubmit",
    reValidateMode: "onChange",
    shouldFocusError: false,
    ...options,
  });
  const values = useWatch({ control: form.control }) as T;
  const set = useCallback(
    <K extends Path<T>>(name: K, action: SetStateAction<PathValue<T, K>>) => {
      const value =
        typeof action === "function"
          ? (action as (previous: PathValue<T, K>) => PathValue<T, K>)(
              form.getValues(name),
            )
          : action;
      form.setValue(name, value, {
        shouldDirty: true,
        shouldValidate: !!form.getFieldState(name).error,
      });
    },
    [form],
  );
  const state = <K extends Path<T>>(
    name: K,
  ): [PathValue<T, K>, (action: SetStateAction<PathValue<T, K>>) => void] => [
    values[name] ?? form.getValues(name),
    (action) => set(name, action),
  ];
  const a11y = (name: Path<T>, id: string) => ({
    "aria-invalid": !!form.getFieldState(name, form.formState).error,
    "aria-describedby": form.getFieldState(name, form.formState).error
      ? `${id}-error`
      : undefined,
  });
  const handleSubmit: UseFormHandleSubmit<T> =
    (onValid, onInvalid) => (event) => {
      // Conditional fields can register after fields farther down the page.
      // Use rendered order instead of RHF's registration order on submission.
      const element = event?.target;
      return form.handleSubmit(onValid, async (errors, invalidEvent) => {
        requestAnimationFrame(() => {
          if (element instanceof HTMLFormElement && element.isConnected) {
            for (const control of element.querySelectorAll<
              HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
            >("[name]")) {
              const name = control.name as Path<T>;
              if (
                control.disabled ||
                control.closest("[hidden], [inert]") ||
                !form.getFieldState(name, { ...form.formState, errors }).error
              )
                continue;
              if (
                control instanceof HTMLInputElement &&
                control.type === "hidden"
              ) {
                control
                  .closest(".custom-select")
                  ?.querySelector<HTMLButtonElement>('[role="combobox"]')
                  ?.focus();
              } else {
                control.focus();
              }
              if (
                document.activeElement === control ||
                control
                  .closest(".custom-select")
                  ?.contains(document.activeElement)
              )
                break;
            }
          }
        });
        await onInvalid?.(errors, invalidEvent);
      })(event);
    };
  return { ...form, handleSubmit, values, set, state, a11y };
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  const { errorText, t } = useI18n();
  const minimum = /^Enter at least (\d+) characters\.$/.exec(message ?? "");
  const maximum = /^Use at most (\d+) characters\.$/.exec(message ?? "");
  const text = minimum
    ? t("Enter at least {minimum} characters.", { minimum: minimum[1] })
    : maximum
      ? t("Use at most {maximum} characters.", { maximum: maximum[1] })
      : errorText(message ?? "");
  return message ? (
    <p id={`${id}-error`} className="field-error" role="alert">
      {text}
    </p>
  ) : null;
}

// Board fields commit every edit to the shared workspace, including unfinished
// values. RHF manages interaction/errors; attachment validation remains separate.
export function BoardTextField({
  value,
  onChange,
  maxLength = 300,
  multiline = false,
  rows,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
}) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const form = useForm({
    resolver: zodResolver(z.object({ value: z.string().max(maxLength) }), {
      error: formErrorMap,
    }),
    values: { value },
    mode: "onTouched",
    reValidateMode: "onChange",
  });
  return (
    <Controller
      control={form.control}
      name="value"
      render={({ field, fieldState }) => {
        const shared = {
          id,
          name: id,
          value: field.value,
          onBlur: field.onBlur,
          maxLength,
          disabled: props.disabled,
          "aria-invalid": !!fieldState.error,
          "aria-describedby": fieldState.error
            ? `${id}-error`
            : props["aria-describedby"],
          onChange: (
            event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
          ) => {
            field.onChange(event);
            onChange(event.target.value);
          },
        };
        return (
          <>
            {multiline ? (
              <textarea
                rows={rows}
                aria-label={props["aria-label"]}
                className={props.className}
                ref={field.ref}
                {...shared}
              />
            ) : (
              <input {...props} ref={field.ref} {...shared} />
            )}
            <FieldError id={id} message={fieldState.error?.message} />
          </>
        );
      }}
    />
  );
}

export function BoardNumberField({
  value,
  onChange,
  min,
  max,
  step,
  type = "number",
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "min" | "max" | "step" | "type"
> & {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  type?: "number" | "range";
}) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const schema = z.object({
    value: z.string().refine((raw) => {
      const number = Number(raw),
        increment = (number - min) / step;
      return (
        raw.trim() !== "" &&
        Number.isFinite(number) &&
        number >= min &&
        number <= max &&
        Math.abs(increment - Math.round(increment)) < 1e-7
      );
    }, "Enter a value within the range using the displayed step."),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    values: { value: String(value) },
    mode: "onTouched",
    reValidateMode: "onChange",
  });
  return (
    <Controller
      control={form.control}
      name="value"
      render={({ field, fieldState }) => (
        <>
          <input
            {...props}
            {...field}
            name={id}
            id={id}
            min={min}
            max={max}
            step={step}
            type={type}
            aria-invalid={!!fieldState.error}
            aria-describedby={fieldState.error ? `${id}-error` : undefined}
            onChange={(event) => {
              field.onChange(event);
              if (schema.safeParse({ value: event.target.value }).success)
                onChange(Number(event.target.value));
            }}
          />
          <FieldError id={id} message={fieldState.error?.message} />
        </>
      )}
    />
  );
}
