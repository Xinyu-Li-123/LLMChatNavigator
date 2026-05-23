# TODO List

## Feature

- [ ] Implement search as a separate overlay that shows each matched node in a row

- [ ] When navigate, we should move top of the message to top of the page, and highlight the message somehow

- [ ] Switch branch on clicking node from an inactive branch

- [ ] Add a small view of full graph at top right of popup window

- [ ] Define popup button and window position using relative unit, so it is robust against page zoom in / out

- [ ] Add a popup window for editing message in our nav ui. We will add a button to invoke this popup in the in-place edit msg window in nav ui.

- [ ] Toggle nav ui view mode: allow user to hide message text, show it as a circle, and only show text on hover. Do we really want this?

- [ ] Allow replying to a node inside the nav ui. Note that this is different from editing a node, since replying will append new message.

- [x] Can we hide the popup button after clicking it and expanding the popup pane?

- [x] We should load the tree once, and avoid re-parsing everything when we expand-hide-expand the window.

- [x] In toolbar, add a button to go back to the selected message without changing zoom level

## Bug

- [ ] ChatGPT has pagination in infinite-scroll style. We need some way to allow navigating to messages that are not loaded in current page

- [ ] `data-turn-id-container` and `data-message-id` are two different values. One turn can contain multiple messages from chatgpt, e.g. it first make tool call, then produce CoT, and finally output answer, making it 3 messages in one turn.

- [ ] Remove the non-message node, e.g. node that makes tool call

- [ ] Disable edit and resend option for non-user message

## Maintenance

## Performance

## Nope
