# Novel Draft labels are created on Publish

Inbox label editing may assign names that are not yet in the Label catalog. Those names stay local on the Draft; GitHub labels are created only during Publish (or a later remote update), using a fixed default color. Immediate remote create while editing was rejected because it surprises users and breaks the Capture → Inbox → Publish model. Per-novel color picking in the Inbox was rejected as out of scope for #23. After a successful create, that repository’s Label catalog is updated so the Inbox strip matches GitHub.
