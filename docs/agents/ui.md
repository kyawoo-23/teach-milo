# UI

Style with hand-written CSS in `globals.css` and CSS modules.

## Lists and modals

Use flat rows: a badge, a title, a text link, and icon actions.

Session and history modals keep a fixed header and footer. Only the body scrolls. Show one column of essentials, and expand a row for detail.

Truncate tight header and toolbar labels so they stay on one line.

Modal close buttons match the other modals.

## Session header

My Sessions, End session, and the language selector use the same control size as the home and profile controls.

## Board editor

Toolbars are compact icon groups. The sketch-board strip is the size reference.

Primary add actions are full buttons when there is room.

Teaching-board workspace buttons and in-card numeric inputs are 32px tall, matching that strip. Modal body fields and the board-tool combobox keep their own height.

## Text fields

Board sidebar label and value fields — sketch, concept map, matching, and comparison table — are plain text inputs. Leave Write/Preview chrome and inline KaTeX off those controls.

Home paste notes, the session composer, and the independent-check answer are rich fields. Formatting shows in place, and the saved value is Markdown. The selection toolbar is bold, italic, code, heading, and lists. Leave Write/Preview tabs and formula buttons off that toolbar.
