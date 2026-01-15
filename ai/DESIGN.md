I want to develop a plugin for Superproductivity that performs autoplanning of the tasks.

Here are the api for the plugins: https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md

The algorithm is the same as this project: https://github.com/00sapo/taskcheck

The idea is the following:

1. assign a base priority to each task given by the order they have in the list of the tasks (i.e
   N+1-r, where N i the number of tasks and r is the rank of the task)
2. assign other priority factors based on tags, the user can set the association tag-priority boost in the custom UI sandboxed iframe
3. assign a priority factor given by task estimated duration (formula defined by the user in the
   iframe)
4. assign a priority factor given by task oldness (still factor defined by the user in the iframe)

At this point, all tasks must be split in a defined block size (e.g. 2h). If there are sub-tasks, the parent tasks are just leaved out from the algorithm. At the end, we should have tasks like "Task name I", "Task name II", etc. The original tasks should be removed. There should be a link among the splits, so users can merge them if needed.

Then, the autoplanning starts:
1. assign a block of the most urgent task
2. recompute the urgency as if the time is passed and the assigned task has reduced estimation time
3. restart from 1.
