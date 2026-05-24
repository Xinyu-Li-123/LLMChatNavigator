# TODO List

## Feature

- [ ] Switch branch on clicking node from an inactive branch

- [ ] Add the `ConvoController.subscribe()` interface, and implement it for `ChatGptConvoController` where we observe mutation, and determine types of actions to take, e.g. user swap conversation, user switch branch, user edit and resubmit a message.

- [ ] When navigate, we should move top of the message to top of the page, and highlight the message somehow

- [ ] Allow replying to a node inside the nav ui. Note that this is different from editing a node, since replying will append new message.

- [ ] Implement search as a separate overlay that shows each matched node in a row

- [ ] Add a small view of full graph at top right of popup window

- [ ] Define popup button and window position using relative unit, so it is robust against page zoom in / out

- [ ] Add a popup window for editing message in our nav ui. We will add a button to invoke this popup in the in-place edit msg window in nav ui.

- [ ] Toggle nav ui view mode: allow user to hide message text, show it as a circle, and only show text on hover. Do we really want this?

- [ ] Add a loading effect during navigation. E.g. add a gray overlay on top of entire page with a loading circle with text during navigation, and remove that until navigation complete

  This is gonna be a big one

- [x] Can we hide the popup button after clicking it and expanding the popup pane?

- [x] We should load the tree once, and avoid re-parsing everything when we expand-hide-expand the window.

- [x] In toolbar, add a button to go back to the selected message without changing zoom level

## Bug

- [ ] Remove the non-message node, e.g. node that makes tool call

- [ ] Disable edit and resend option for non-user message

- [ ] Add a virtual head node so that branching on first message work

- [ ] If user switch branch directly in the webpage, it won't be reflected in our UI

  While we can poll to check the webpage html in syncConvo to achieve this, this bug can only be reliably fixed by implementing the subscribe() method in the convo controller interface.

- [x] `data-turn-id-container` and `data-message-id` are two different values. One turn can contain multiple messages from chatgpt, e.g. it first make tool call, then produce CoT, and finally output answer, making it 3 messages in one turn.

- [x] ChatGPT has pagination in infinite-scroll style. We need some way to allow navigating to messages that are not loaded in current page

  We can modify the implementation of `scrollStep.execute()` to keep scrolling until hit or not found

  To do this, we need to first parse the webpage to find furthest possible message's id, scroll to it, wait for DOM to load (either timeout or MutationObserver), and scan-and-scroll again. Do this until target message id is present in the page.

## Maintenance

- [ ] Cleanup unused code caused by the previously ignored source code files (the `*.ign.*` files)

## Performance

## Nope
