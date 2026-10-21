"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@bigcommerce/big-design";
import { HELP_CONTENT } from "@/lib/huntry/help-content";
import "./help-info-button.css";

// The plugin's "?" glyph (.huntry-admin-info-icon): a literal character, not
// an icon font.
function QuestionMark({ variant }: { variant: "button" | "modal" }) {
  return (
    <span aria-hidden className={`huntry-help-icon huntry-help-icon--${variant}`}>
      ?
    </span>
  );
}

// huntry_render_admin_info_button / ..._modal (huntry/includes/admin/index.php).
// Mounted once in MainNav, so the content follows the active tab like the
// plugin's shared header. The dialog is a hand-rolled 380px card (BigDesign's
// Modal can't be narrowed — see ConfirmDialog in map/egg-dialogs.tsx) and only
// renders while open, so nothing touches `document` during SSR. Styles live in
// help-info-button.css.
export function HelpInfoButton({ sectionId }: { sectionId: string | undefined }) {
  const [isOpen, setIsOpen] = useState(false);
  const content = sectionId ? HELP_CONTENT[sectionId] : undefined;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  if (!content) {
    return null;
  }

  const close = () => setIsOpen(false);

  return (
    <>
      <button
        aria-label="How this tab works"
        className="huntry-help-button"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <QuestionMark variant="button" />
      </button>

      {isOpen
        ? createPortal(
            <div className="huntry-help-modal" onClick={close}>
              <div
                aria-label={content.title}
                aria-modal="true"
                className="huntry-help-modal__dialog"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
              >
                <div className="huntry-help-modal__header">
                  <span className="huntry-help-modal__icon">
                    <QuestionMark variant="modal" />
                  </span>
                  <p className="huntry-help-modal__headline">{content.title}</p>
                </div>

                <p className="huntry-help-modal__message">{content.description}</p>

                {content.steps.length > 0 ? (
                  <ol className="huntry-help-modal__steps">
                    {content.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                ) : null}

                <div className="huntry-help-modal__actions">
                  <Button onClick={close} variant="primary">
                    Close
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
