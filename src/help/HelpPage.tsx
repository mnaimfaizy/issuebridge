import { Body1, Title3 } from "@fluentui/react-components";

/** Placeholder Help destination; full Help content lands in a later slice. */
export function HelpPage() {
  return (
    <section className="ib-destination" aria-labelledby="help-heading">
      <header className="ib-destination-header">
        <Title3 as="h1" id="help-heading">
          Help
        </Title3>
        <Body1>
          Shortcuts, How it works, and About will live here. Capture → Draft →
          Inbox → Publish stays the product path.
        </Body1>
      </header>
    </section>
  );
}
